// READ-ONLY audit script. Does not write/update/delete anything.
//
// PHASE 0 of the order-status SSOT work. Purpose: replace assumptions with real numbers
// before any code is changed. It answers two questions with live data:
//
//   (A) CURRENT STATUS — how far apart are the stored status fields, and how many orders
//       would render a DIFFERENT label on the customer side vs the admin side today?
//       It replays, in memory only, the exact derivations that ship right now:
//         customer : frontend/src/helpers/orderPresentation.js  getItemStatusMeta()
//         admin    : frontend/src/pages/AdminClientWorkspace.js getProjectDisplayStatus()
//                    (same rules as backend controller/user/getAdminUserWorkspace.js)
//       Nothing is inferred — the two functions are transcribed verbatim below.
//
//   (B) HISTORY — which lifecycle timestamps exist on real orders and which are missing,
//       and for the missing ones, whether a backfill source exists (a transaction date,
//       a projectNodeEvents entry). This decides Phase 3's real scope.
//
// It also reports the fact-level bugs the code review predicted, as live counts:
//   - orders stuck at orderVisibility 'pending-approval' despite real completed money
//     (the controller/order/createOrder.js wallet gap)
//   - cancelled orders whose `status` still reads 'in_progress'/'completed'
//     (the admin "cancelled project shows In Progress" report)
//
// Run:  node scripts/readOnlyAuditOrderStatusSsot.js [orderId]
//   - with an orderId: dumps every status field + derivation for exactly that order.
//   - without: audits ALL orders and prints aggregate counts + capped samples.
//
// SAFETY: connects with the URI in .env, which on this machine points at production.
// This script only reads (find/lean). It never calls save/update/delete.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
require("../models/productModel"); // register 'product' so populate('productId') works

const SAMPLE = Number(process.env.AUDIT_SAMPLE || 8);

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const head = (s) => { line(""); sep(); line(s); sep(); };

// ---------------------------------------------------------------------------
// Order-type classification — transcribed from frontend/src/helpers/orderType.js
// ---------------------------------------------------------------------------
const PROJECT_CATEGORIES = new Set([
  "standard_websites", "dynamic_websites", "cloud_software_development",
  "app_development", "web_applications", "mobile_apps",
]);
const PLAN_CATEGORIES = new Set(["website_updates", "service_plan"]);

const isProjectItem = (o) =>
  Boolean(o?.isWebsiteProject) ||
  PROJECT_CATEGORIES.has(o?.projectSnapshot?.category?.toLowerCase()) ||
  PROJECT_CATEGORIES.has(o?.productId?.category?.toLowerCase());

const isPlanItem = (o) => PLAN_CATEGORIES.has(o?.productId?.category?.toLowerCase());

const isOrderApproved = (o) =>
  o?.orderVisibility === "approved" || o?.orderVisibility === "visible";

const getRemainingDays = (o) => {
  if (!o) return 0;
  if ((o.productId?.isMonthlyRenewablePlan || o.productId?.isMonthlyLimitedPlan) && o.currentMonthExpiryDate) {
    return Math.max(0, Math.ceil((new Date(o.currentMonthExpiryDate) - new Date()) / 86400000));
  }
  if (!o.createdAt || !o.productId?.validityPeriod) return 0;
  const end = new Date(o.createdAt);
  end.setDate(end.getDate() + o.productId.validityPeriod);
  return Math.max(0, Math.ceil((end - new Date()) / 86400000));
};

// ---------------------------------------------------------------------------
// CUSTOMER derivation — verbatim from orderPresentation.js getItemStatusMeta()
// `hasUnpaidInvoice` is computed by getUserOrder.js at request time, so it is
// supplied here from the same due-installment rule (see computeHasUnpaidInvoice).
// ---------------------------------------------------------------------------
const customerStatus = (o) => {
  if (!o) return "Unknown";
  if (o.orderVisibility === "cancelled") return "Cancelled";
  if (o.orderVisibility === "payment-rejected") return "Payment Rejected";
  if (o.orderVisibility === "pending-approval") return "Approval Pending";

  if (isProjectItem(o)) {
    if (o.projectProgress >= 100 || o.currentPhase === "completed") return "Completed";
    if (o.hasUnpaidInvoice) return "Payment Pending";
    if (isOrderApproved(o)) {
      const p = Math.round(o.projectProgress || 0);
      return p === 0 ? "Payment Approved" : "In Progress " + p + "%";
    }
  }

  if (isPlanItem(o)) {
    const closed =
      o.planStatus === "closed" ||
      !o.isActive ||
      (o.productId?.isMonthlyRenewablePlan || o.productId?.isMonthlyLimitedPlan
        ? (o.totalYearlyDaysRemaining || 0) <= 0
        : (o.updatesUsed || 0) >= (o.productId?.updateCount || 0));
    if (closed) return "Closed";
    if (isOrderApproved(o) && getRemainingDays(o) > 0) return "Active plan";
  }

  return "Processing";
};

// ---------------------------------------------------------------------------
// ADMIN derivation — verbatim from AdminClientWorkspace.js getProjectDisplayStatus()
// NOTE the `status` values it tests for ('rejected'/'cancelled'/'canceled') are NOT in
// orderProductModel's status enum ['pending','in_progress','completed'] — that branch can
// never match. The transcription keeps the bug so the audit measures its real impact.
// ---------------------------------------------------------------------------
const adminStatus = (o) => {
  if (o?.orderVisibility === "pending-approval" || o?.status === "pending") return "Processing";
  if (o?.orderVisibility === "payment-rejected" || ["rejected", "cancelled", "canceled"].includes(o?.status)) {
    return "Rejected";
  }
  if ((o?.projectProgress || 0) >= 100 || o?.currentPhase === "completed" || o?.status === "completed") {
    return "Completed";
  }
  return "In Progress";
};

// Do the two labels mean the same thing? The wordings differ by design
// ("In Progress 45%" vs "In Progress"), so compare the underlying meaning, not the text.
const meaningOf = (label) => {
  const l = String(label).toLowerCase();
  if (l.startsWith("cancelled")) return "CANCELLED";
  if (l.includes("rejected")) return "REJECTED";
  if (l === "completed") return "COMPLETED";
  if (l.includes("approval pending") || l === "processing") return "PENDING";
  if (l.includes("payment pending")) return "PAYMENT_DUE";
  if (l.includes("in progress") || l.includes("payment approved")) return "IN_PROGRESS";
  if (l === "closed") return "CLOSED";
  if (l === "active plan") return "ACTIVE";
  return "OTHER:" + l;
};

// ---------------------------------------------------------------------------
// hasUnpaidInvoice — the due-installment rule from helpers/projectDuePayment.js,
// replayed here so the customer derivation gets the same input it does in production.
// ---------------------------------------------------------------------------
const computeHasUnpaidInvoice = async (order) => {
  const anyUnpaid = async () =>
    Boolean(await invoiceModel.exists({ orderId: order._id, status: { $in: ["unpaid", "overdue"] } }));

  if (!order.isWebsiteProject) return anyUnpaid();

  const installments = Array.isArray(order.installments) ? order.installments : [];
  const nextUnpaid = installments.find((i) => !i.paid);
  if (!nextUnpaid) return anyUnpaid();

  const threshold = nextUnpaid.progressThreshold;
  const progress = Math.round(order.projectProgress || 0);
  const isDue = threshold == null ? true : progress >= Number(threshold);
  if (!isDue) return false;
  return anyUnpaid();
};

const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

// ---------------------------------------------------------------------------
// Single-order deep dump
// ---------------------------------------------------------------------------
const dumpOne = async (order) => {
  order.hasUnpaidInvoice = await computeHasUnpaidInvoice(order);
  const txns = await transactionModel.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
  const events = order.projectNodeEvents || [];
  const firstCompleted = txns.find((t) => t.status === "completed");
  const completedEvent = events.find((e) => Number(e.nextProgress) >= 100);

  head("ORDER " + order._id);
  line("  name              : " + (order.projectSnapshot?.displayName || order.productId?.serviceName || order.servicePlanSnapshot?.serviceName || "(unnamed)"));
  line("  type              : project=" + isProjectItem(order) + "  plan=" + isPlanItem(order) + "  service=" + Boolean(order.isServicePlan));
  line("");
  line("  STORED STATUS FIELDS (all 7):");
  line("    orderVisibility   : " + order.orderVisibility);
  line("    status            : " + order.status);
  line("    projectProgress   : " + order.projectProgress);
  line("    currentPhase      : " + order.currentPhase);
  line("    planStatus        : " + (order.planStatus ?? "-"));
  line("    isActive          : " + (order.isActive ?? "-"));
  line("    autoRenewalStatus : " + (order.autoRenewalStatus ?? "-"));
  line("    servicePlanStatus : " + (order.servicePlanStatus ?? "-"));
  line("");
  line("  DERIVED LABELS (replayed, no writes):");
  const c = customerStatus(order);
  const a = adminStatus(order);
  line("    customer sees     : " + c);
  line("    admin sees        : " + a);
  line("    same meaning?     : " + (meaningOf(c) === meaningOf(a) ? "YES" : "NO   (" + meaningOf(c) + " vs " + meaningOf(a) + ")"));
  line("");
  line("  LIFECYCLE TIMESTAMPS:");
  line("    createdAt         : " + fmtDate(order.createdAt));
  line("    approvedAt        : (field does not exist)   backfill source: " + (firstCompleted ? "transaction " + fmtDate(firstCompleted.createdAt) : "NONE"));
  line("    rejectedAt        : (field does not exist)   backfill source: NONE");
  line("    startedAt         : (field does not exist)   backfill source: " + (events.length ? "nodeEvent " + fmtDate(events[0].occurredAt) : "NONE"));
  line("    completedAt       : (field does not exist)   backfill source: " + (completedEvent ? "nodeEvent " + fmtDate(completedEvent.occurredAt) : "NONE"));
  line("    cancelledAt       : " + fmtDate(order.cancelledAt));
  line("    updatedAt         : " + fmtDate(order.updatedAt) + "   (overwritten by any later change)");
  line("");
  line("  progress events recorded: " + events.length);
  line("  transactions            : " + txns.length + "  (completed: " + txns.filter((t) => t.status === "completed").length + ")");
};

// ---------------------------------------------------------------------------
// Full sweep
// ---------------------------------------------------------------------------
const sweep = async () => {
  const orders = await orderProductModel
    .find({})
    .populate("productId", "serviceName category validityPeriod updateCount isMonthlyRenewablePlan isMonthlyLimitedPlan")
    .lean();

  line("Loaded " + orders.length + " order(s).");

  // hasUnpaidInvoice for every order, so the customer replay matches production.
  for (const o of orders) o.hasUnpaidInvoice = await computeHasUnpaidInvoice(o);

  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  // ---- (A1) raw field distributions ----
  const dist = {
    orderVisibility: new Map(), status: new Map(), currentPhase: new Map(),
    planStatus: new Map(), isActive: new Map(), autoRenewalStatus: new Map(),
    servicePlanStatus: new Map(),
  };
  for (const o of orders) {
    bump(dist.orderVisibility, String(o.orderVisibility));
    bump(dist.status, String(o.status));
    bump(dist.currentPhase, String(o.currentPhase));
    bump(dist.planStatus, String(o.planStatus));
    bump(dist.isActive, String(o.isActive));
    bump(dist.autoRenewalStatus, String(o.autoRenewalStatus));
    bump(dist.servicePlanStatus, String(o.servicePlanStatus));
  }

  head("(A1) STORED STATUS FIELD DISTRIBUTIONS");
  for (const [field, m] of Object.entries(dist)) {
    line("  " + field + ":");
    [...m.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, v]) => line("      " + String(k).padEnd(20) + v));
  }

  // ---- (A2) customer vs admin label disagreement ----
  const disagree = [];
  const pairCounts = new Map();
  for (const o of orders) {
    const c = customerStatus(o);
    const a = adminStatus(o);
    if (meaningOf(c) !== meaningOf(a)) {
      bump(pairCounts, c + "  ||  " + a);
      if (disagree.length < SAMPLE) {
        disagree.push({ id: o._id, c, a, vis: o.orderVisibility, st: o.status, pr: o.projectProgress });
      }
    }
  }
  const disagreeTotal = [...pairCounts.values()].reduce((s, v) => s + v, 0);

  head("(A2) CUSTOMER vs ADMIN - SAME ORDER, DIFFERENT MEANING");
  line("  orders where the two sides disagree : " + disagreeTotal + " / " + orders.length);
  line("");
  line("  breakdown (customer label || admin label):");
  [...pairCounts.entries()].sort((x, y) => y[1] - x[1]).forEach(([k, v]) => line("      " + String(v).padStart(4) + "   " + k));
  line("");
  line("  samples (max " + SAMPLE + "):");
  disagree.forEach((d) => {
    line("      " + d.id + "  vis=" + d.vis + " status=" + d.st + " progress=" + d.pr);
    line('          customer="' + d.c + '"   admin="' + d.a + '"');
  });

  // ---- (A3) predicted fact-level bugs, as live counts ----
  head("(A3) FACT-LEVEL BUGS - LIVE COUNTS");

  // Bug 1: cancelled order whose `status` was never touched by the cancel path.
  const cancelledStale = orders.filter((o) => o.orderVisibility === "cancelled" && o.status !== "pending");
  line("  [1] cancelled orders whose status is still in_progress/completed : " + cancelledStale.length);
  line("      (cancelProjectOrder.js writes orderVisibility only - this is the admin 'In Progress' report)");
  cancelledStale.slice(0, SAMPLE).forEach((o) =>
    line("      " + o._id + "  status=" + o.status + "  progress=" + o.projectProgress + '  admin sees="' + adminStatus(o) + '"'));

  // Bug 2: money actually landed, but the order never left pending-approval.
  const pendingIds = orders.filter((o) => o.orderVisibility === "pending-approval").map((o) => o._id);
  const paidTxns = pendingIds.length
    ? await transactionModel.find({ orderId: { $in: pendingIds }, status: "completed" }).select("orderId amount paymentMethod createdAt").lean()
    : [];
  const paidByOrder = new Map();
  paidTxns.forEach((t) => {
    const k = String(t.orderId);
    paidByOrder.set(k, [...(paidByOrder.get(k) || []), t]);
  });
  const stuckPending = orders.filter((o) => o.orderVisibility === "pending-approval" && paidByOrder.has(String(o._id)));
  line("");
  line("  [2] orders stuck 'pending-approval' despite COMPLETED money : " + stuckPending.length);
  line("      (the controller/order/createOrder.js wallet gap - never flips to 'approved')");
  stuckPending.slice(0, SAMPLE).forEach((o) => {
    const ts = paidByOrder.get(String(o._id));
    line("      " + o._id + "  paid=" + ts.map((t) => t.paymentMethod + ":" + t.amount).join(",") + "  paidAmount=" + o.paidAmount);
  });

  // Bug 3: progress says done, status/phase disagree (or vice versa).
  const progressMismatch = orders.filter((o) => {
    const done100 = (o.projectProgress || 0) >= 100;
    const phaseDone = o.currentPhase === "completed";
    const statusDone = o.status === "completed";
    return isProjectItem(o) && (done100 || phaseDone || statusDone) && !(done100 && phaseDone && statusDone);
  });
  line("");
  line("  [3] projects where progress / currentPhase / status disagree about 'done' : " + progressMismatch.length);
  progressMismatch.slice(0, SAMPLE).forEach((o) =>
    line("      " + o._id + "  progress=" + o.projectProgress + " phase=" + o.currentPhase + " status=" + o.status));

  // Bug 4: plan pause flags vs real overdue invoices.
  const planOrders = orders.filter((o) => isPlanItem(o));
  let planMismatch = 0;
  const planSamples = [];
  for (const o of planOrders) {
    const overdue = await invoiceModel.exists({ orderId: o._id, status: { $in: ["unpaid", "overdue"] } });
    const paused = o.isActive === false;
    if (Boolean(overdue) !== paused) {
      planMismatch++;
      if (planSamples.length < SAMPLE) {
        planSamples.push(o._id + "  isActive=" + o.isActive + " autoRenewal=" + o.autoRenewalStatus + " planStatus=" + o.planStatus + " hasOverdueInvoice=" + Boolean(overdue));
      }
    }
  }
  line("");
  line("  [4] plans whose isActive flag disagrees with their real invoice state : " + planMismatch + " / " + planOrders.length);
  line("      (invoiceLifecycle.js writes isActive by hand - it is derivable from invoices)");
  planSamples.forEach((s) => line("      " + s));

  // ---- (B) history coverage + backfill feasibility ----
  head("(B) LIFECYCLE HISTORY - WHAT EXISTS, WHAT CAN BE RECOVERED");

  const allIds = orders.map((o) => o._id);
  const allCompletedTxns = await transactionModel
    .find({ orderId: { $in: allIds }, status: "completed" })
    .select("orderId createdAt").sort({ createdAt: 1 }).lean();
  const firstTxnByOrder = new Map();
  allCompletedTxns.forEach((t) => {
    const k = String(t.orderId);
    if (!firstTxnByOrder.has(k)) firstTxnByOrder.set(k, t.createdAt);
  });

  const cov = {
    created: 0, cancelled: 0,
    approvedRecoverable: 0, approvedLost: 0,
    startedRecoverable: 0, startedLost: 0,
    completedRecoverable: 0, completedLost: 0,
    rejectedLost: 0,
  };

  for (const o of orders) {
    cov.created++;
    if (o.cancelledAt) cov.cancelled++;

    const events = o.projectNodeEvents || [];

    // approved - only meaningful for orders that actually reached approved
    if (isOrderApproved(o)) {
      if (firstTxnByOrder.has(String(o._id))) cov.approvedRecoverable++;
      else cov.approvedLost++;
    }
    // rejected - no source exists anywhere
    if (o.orderVisibility === "payment-rejected") cov.rejectedLost++;
    // started / completed - from the node event log
    if (isProjectItem(o)) {
      if (events.length) cov.startedRecoverable++;
      else cov.startedLost++;

      if ((o.projectProgress || 0) >= 100 || o.currentPhase === "completed") {
        if (events.some((e) => Number(e.nextProgress) >= 100)) cov.completedRecoverable++;
        else cov.completedLost++;
      }
    }
  }

  line("  event                stored today        backfill-recoverable   unrecoverable");
  line("  created              " + String(cov.created).padEnd(20) + "-                      -");
  line("  cancelled            " + String(cov.cancelled).padEnd(20) + "-                      -");
  line("  approved             none                " + String(cov.approvedRecoverable).padEnd(23) + cov.approvedLost);
  line("  started (first work) none                " + String(cov.startedRecoverable).padEnd(23) + cov.startedLost);
  line("  completed            none                " + String(cov.completedRecoverable).padEnd(23) + cov.completedLost);
  line("  rejected             none                0                      " + cov.rejectedLost + "   <-- confirmed unrecoverable");

  // ---- doc-size evidence for the separate-collection decision ----
  head("(C) ORDER DOCUMENT SIZE - evidence for keeping the event log in its own collection");
  const sizes = orders
    .map((o) => ({
      id: o._id,
      bytes: Buffer.byteLength(JSON.stringify(o)),
      events: (o.projectNodeEvents || []).length,
      nodes: (o.projectNodes || []).length,
    }))
    .sort((a, b) => b.bytes - a.bytes);
  const totalBytes = sizes.reduce((s, x) => s + x.bytes, 0);
  line("  orders            : " + sizes.length);
  line("  average doc size  : " + Math.round(totalBytes / (sizes.length || 1)).toLocaleString() + " bytes");
  line("  largest doc size  : " + (sizes[0] ? sizes[0].bytes.toLocaleString() : 0) + " bytes  (16MB Mongo limit)");
  line("");
  line("  heaviest orders (max " + SAMPLE + "):");
  sizes.slice(0, SAMPLE).forEach((s) =>
    line("      " + s.id + "  " + String(s.bytes).padStart(9) + " bytes   nodes=" + s.nodes + " events=" + s.events));
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }

  // The URI on this machine points at production - say so out loud before reading.
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);

  await mongoose.connect(uri);
  line("connected (read-only audit - this script never writes)");

  const argId = process.argv[2];
  if (argId) {
    const order = await orderProductModel
      .findById(argId)
      .populate("productId", "serviceName category validityPeriod updateCount isMonthlyRenewablePlan isMonthlyLimitedPlan")
      .lean();
    if (!order) line("No order found with _id " + argId);
    else await dumpOne(order);
  } else {
    await sweep();
  }

  line("");
  sep();
  await mongoose.disconnect();
  line("done (nothing was modified)");
};

main().catch(async (error) => {
  console.error("Audit failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
