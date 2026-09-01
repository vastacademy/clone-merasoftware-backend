// READ-ONLY shadow comparison. Does not write/update/delete anything.
//
// Runs helpers/orderStatusEngine.js side by side with the five status derivations that ship
// today, over every real order, and reports every difference. The engine is not wired into any
// response yet — this is the check that has to pass BEFORE it is, so that switching a surface
// over is a decision made against measured differences rather than a hope.
//
// The five current derivations are transcribed verbatim below, bugs included, because the point
// is to measure what users see today — not what the code was meant to do:
//
//   customerList  frontend/src/helpers/orderPresentation.js   getItemStatusMeta()
//   orderPage     frontend/src/pages/OrderPage.js             getOrderStatus()
//   adminProject  frontend/src/pages/AdminClientWorkspace.js  getProjectDisplayStatus()
//   adminPlan     frontend/src/pages/AdminClientWorkspace.js  getPlanDisplayStatus()
//   orderDetails  backend/controller/order/getOrderDetails.js inline status string
//
// Every difference is classified, because "different" is not the same as "wrong":
//   EXPECTED — the engine deliberately corrects a known bug. Each one is named.
//   REVIEW   — a difference the engine did not set out to make. These are what matter.
//
// Run:  node scripts/readOnlyShadowCompareStatusEngine.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const { getOrderState, STATUS, PHASE } = require("../helpers/orderStatusEngine");
const { getDueUnpaidInvoiceFilter } = require("../helpers/projectDuePayment");
require("../models/productModel"); // register 'product' so populate('productId') works

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(94));
const head = (s) => { line(""); sep(); line(s); sep(); };

// ── the shipping derivations, transcribed ─────────────────────────────────────────────────
const PROJECT_CATEGORIES = new Set([
  "standard_websites", "dynamic_websites", "cloud_software_development",
  "app_development", "web_applications", "mobile_apps",
]);
const PLAN_CATEGORIES = new Set(["website_updates", "service_plan"]);
const lower = (v) => String(v || "").toLowerCase();

const isProjectItem = (o) =>
  Boolean(o?.isWebsiteProject) ||
  PROJECT_CATEGORIES.has(lower(o?.projectSnapshot?.category)) ||
  PROJECT_CATEGORIES.has(lower(o?.productId?.category));
const isPlanItem = (o) => PLAN_CATEGORIES.has(lower(o?.productId?.category));
const isOrderApproved = (o) => o?.orderVisibility === "approved" || o?.orderVisibility === "visible";

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

// orderPresentation.js getItemStatusMeta()
const customerList = (o) => {
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
      o.planStatus === "closed" || !o.isActive ||
      (o.productId?.isMonthlyRenewablePlan || o.productId?.isMonthlyLimitedPlan
        ? (o.totalYearlyDaysRemaining || 0) <= 0
        : (o.updatesUsed || 0) >= (o.productId?.updateCount || 0));
    if (closed) return "Closed";
    if (isOrderApproved(o) && getRemainingDays(o) > 0) return "Active plan";
  }
  return "Processing";
};

// OrderPage.js getOrderStatus() — note: no 'cancelled' branch at all.
const orderPage = (o) => {
  if (!o) return "Processing";
  if (o.orderVisibility === "payment-rejected") return "Rejected";
  if (o.orderVisibility === "pending-approval") return "Pending approval";
  if (o.projectProgress >= 100 || o.currentPhase === "completed") return "Completed";
  if (isOrderApproved(o)) return "In progress";
  return "Processing";
};

// AdminClientWorkspace.js getProjectDisplayStatus() — tests status values not in the enum.
const adminProject = (o) => {
  if (o?.orderVisibility === "pending-approval" || o?.status === "pending") return "Processing";
  if (o?.orderVisibility === "payment-rejected" || ["rejected", "cancelled", "canceled"].includes(o?.status)) return "Rejected";
  if ((o?.projectProgress || 0) >= 100 || o?.currentPhase === "completed" || o?.status === "completed") return "Completed";
  return "In Progress";
};

// AdminClientWorkspace.js getPlanDisplayStatus()
const adminPlan = (p) => {
  const expiry = p?.currentMonthExpiryDate ? new Date(p.currentMonthExpiryDate) : null;
  const expired = p?.autoRenewalStatus === "expired" || Boolean(expiry && expiry.getTime() < Date.now());
  if (p?.isActive === false || ["cancelled", "canceled", "rejected", "hidden"].includes(p?.status)) return "Inactive";
  if (expired) return "Expired";
  return "Active";
};

// getOrderDetails.js inline status
const orderDetails = (o) => {
  if (o.orderVisibility === "cancelled") return "Cancelled";
  if (o.orderVisibility === "payment-rejected") return "Rejected";
  if (o.orderVisibility === "pending-approval") return "Processing";
  if (o.projectProgress >= 100 || o.currentPhase === "completed") return "Completed";
  if (o.orderVisibility === "approved" || o.orderVisibility === "visible") return "In Progress";
  return "Processing";
};

// Compare MEANING, not wording — the surfaces word the same state differently by design.
const meaningOf = (label) => {
  const l = String(label).toLowerCase();
  if (l.startsWith("cancelled")) return "CANCELLED";
  if (l.includes("rejected")) return "REJECTED";
  if (l === "completed") return "COMPLETED";
  if (l.includes("approval pending") || l.includes("pending approval") || l === "processing") return "PENDING";
  if (l.includes("payment pending")) return "PAYMENT_DUE";
  if (l.includes("payment approved")) return "APPROVED_NOT_STARTED";
  if (l.includes("in progress")) return "IN_PROGRESS";
  if (l === "closed" || l === "inactive" || l === "expired" || l === "paused") return "CLOSED";
  if (l === "active plan" || l === "active") return "ACTIVE";
  return "OTHER:" + l;
};

// The engine's own code mapped onto the same vocabulary.
const engineMeaning = (code) => ({
  [STATUS.CANCELLED]: "CANCELLED",
  [STATUS.REJECTED]: "REJECTED",
  [STATUS.PENDING_APPROVAL]: "PENDING",
  [STATUS.PAYMENT_DUE]: "PAYMENT_DUE",
  [STATUS.APPROVED_NOT_STARTED]: "APPROVED_NOT_STARTED",
  [STATUS.IN_PROGRESS]: "IN_PROGRESS",
  [STATUS.COMPLETED]: "COMPLETED",
  [STATUS.PLAN_ACTIVE]: "ACTIVE",
  [STATUS.PLAN_CLOSED]: "CLOSED",
  [STATUS.PROCESSING]: "PENDING",
}[code] || ("OTHER:" + code));

// Known, intended corrections. Anything not matching one of these needs a human look.
const classify = ({ surface, old: oldM, next: newM, order }) => {
  // Service orders. None of the five shipping derivations reads servicePlanStatus — the column
  // that IS maintained for a service by serviceLifecycle.js, cancelProjectOrder.js and the
  // renewal cron. They classify a service as a project (or, when its productId category happens
  // to be service_plan, as a plan) and answer from progress/isActive instead. Verified against
  // the live rows: a service sitting at servicePlanStatus 'paused' read "Completed", two at
  // 'expired' read "Completed", and four at 'active' read "Closed" or "In progress". The engine
  // reads the real column, so these labels change — owner-reviewed and accepted.
  if (order?.isServicePlan) {
    return "EXPECTED: service order — the shipping derivations never read servicePlanStatus, so paused/expired/active services were mislabelled";
  }
  if (surface === "orderPage" && newM === "CANCELLED" && oldM !== "CANCELLED") {
    return "EXPECTED: OrderPage.js has no cancelled branch — a cancelled order read as its progress instead";
  }
  if (surface === "adminProject" && newM === "CANCELLED" && oldM !== "CANCELLED") {
    return "EXPECTED: admin tested status==='cancelled', a value absent from the status enum, so it never matched";
  }
  if ((surface === "adminProject" || surface === "adminPlan") &&
      order.orderVisibility === "visible" && oldM !== newM) {
    return "EXPECTED: order still carries the schema default 'visible'; the admin path ignored it and fell through to `status`";
  }
  if (surface === "orderPage" && oldM === "IN_PROGRESS" &&
      (newM === "APPROVED_NOT_STARTED" || newM === "PAYMENT_DUE")) {
    return "EXPECTED: OrderPage.js collapses every approved order into 'In progress' — it has no 0% or payment-due case";
  }
  if (surface === "adminProject" && oldM === "IN_PROGRESS" &&
      (newM === "APPROVED_NOT_STARTED" || newM === "PAYMENT_DUE" || newM === "CLOSED" || newM === "ACTIVE")) {
    return "EXPECTED: getProjectDisplayStatus() is applied to non-project rows too and has no such case";
  }
  if (surface === "orderDetails" && oldM === "IN_PROGRESS" &&
      (newM === "APPROVED_NOT_STARTED" || newM === "PAYMENT_DUE")) {
    return "EXPECTED: getOrderDetails.js has no 0% or payment-due case — every approved order read 'In Progress'";
  }
  return null; // -> REVIEW
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { line("No Mongo URI found in .env."); process.exit(1); }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);
  await mongoose.connect(uri);
  line("connected (read-only shadow compare - this script never writes)");

  const orders = await orderProductModel
    .find({})
    .populate("productId", "serviceName category validityPeriod updateCount isMonthlyRenewablePlan isMonthlyLimitedPlan")
    .lean();

  // hasUnpaidInvoice is supplied by getUserOrder.js at request time; reproduce it with the same
  // shared rule so the customer derivation gets the input it really has in production.
  const projectOrders = orders.filter((o) => o.isWebsiteProject);
  const unpaid = projectOrders.length
    ? await invoiceModel.find({ $or: projectOrders.map((o) => getDueUnpaidInvoiceFilter(o)) }).select("orderId").lean()
    : [];
  const unpaidIds = new Set(unpaid.map((i) => String(i.orderId)));
  orders.forEach((o) => { o.hasUnpaidInvoice = unpaidIds.has(String(o._id)); });

  line("Loaded " + orders.length + " order(s).");

  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName ||
    o.servicePlanSnapshot?.serviceName || "(unnamed)";

  const expected = [];
  const review = [];
  const phaseFixes = [];

  for (const order of orders) {
    const engine = getOrderState(order);
    const newM = engineMeaning(engine.code);

    // Each surface is only compared where it is actually used.
    const surfaces = [
      { surface: "customerList", label: customerList(order), applies: true },
      { surface: "orderPage", label: orderPage(order), applies: true },
      { surface: "orderDetails", label: orderDetails(order), applies: true },
      { surface: "adminProject", label: adminProject(order), applies: !isPlanItem(order) || isProjectItem(order) },
      { surface: "adminPlan", label: adminPlan(order), applies: isPlanItem(order) && !isProjectItem(order) },
    ];

    for (const s of surfaces) {
      if (!s.applies) continue;
      const oldM = meaningOf(s.label);
      if (oldM === newM) continue;
      const reason = classify({ surface: s.surface, old: oldM, next: newM, order });
      const row = {
        id: order._id, name: nameOf(order), surface: s.surface,
        oldLabel: s.label, newLabel: engine.label, oldM, newM, reason,
        vis: order.orderVisibility, status: order.status, progress: order.projectProgress,
      };
      (reason ? expected : review).push(row);
    }

    // Phase is not rendered by any of the five derivations — the UI prints order.currentPhase
    // raw (ProjectDetails.js "Current phase", AdminClientWorkspace.js "Phase: ..."). Compare the
    // engine's derived phase against that stored column.
    if (isProjectItem(order) && order.currentPhase !== engine.phase) {
      phaseFixes.push({
        id: order._id, name: nameOf(order),
        stored: order.currentPhase, derived: engine.phase,
        progress: order.projectProgress, vis: order.orderVisibility,
      });
    }
  }

  // ── report ──
  head("(1) DIFFERENCES THAT NEED REVIEW  — " + review.length);
  if (!review.length) {
    line("  none. Every status difference the engine produces is an intended correction.");
  } else {
    review.forEach((r) => {
      line("");
      line("  " + r.id + "  " + r.name + "   [" + r.surface + "]");
      line("     vis=" + r.vis + "  status=" + r.status + "  progress=" + r.progress);
      line('     now : "' + r.oldLabel + '"  (' + r.oldM + ")");
      line('     new : "' + r.newLabel + '"  (' + r.newM + ")");
    });
  }

  head("(2) INTENDED CORRECTIONS  — " + expected.length);
  const byReason = new Map();
  expected.forEach((r) => {
    if (!byReason.has(r.reason)) byReason.set(r.reason, []);
    byReason.get(r.reason).push(r);
  });
  for (const [reason, rows] of byReason) {
    line("");
    line("  " + rows.length + "x  " + reason);
    rows.slice(0, 5).forEach((r) =>
      line('       ' + r.id + "  [" + r.surface + "]  \"" + r.oldLabel + '" -> "' + r.newLabel + '"'));
    if (rows.length > 5) line("       ... and " + (rows.length - 5) + " more");
  }

  head("(3) PHASE CORRECTIONS  — " + phaseFixes.length);
  line("  The stored currentPhase column vs the engine's derived phase.");
  line("  (syncActiveProjectProgress() only ever writes 'completed', or 'development' when an");
  line("   already-completed order drops back below 100% — so ordinary progress leaves it at");
  line("   'planning' forever. This is the '1% but Planning' report.)");
  line("");
  const phaseGroups = new Map();
  phaseFixes.forEach((p) => {
    const k = p.stored + " -> " + p.derived;
    if (!phaseGroups.has(k)) phaseGroups.set(k, []);
    phaseGroups.get(k).push(p);
  });
  for (const [k, rows] of phaseGroups) {
    line("  " + String(rows.length).padStart(3) + "x  " + k);
    rows.slice(0, 6).forEach((p) =>
      line("        " + p.id + "  " + p.name + "  progress=" + p.progress + "%  vis=" + p.vis));
    if (rows.length > 6) line("        ... and " + (rows.length - 6) + " more");
  }

  head("SUMMARY");
  line("  orders compared        : " + orders.length);
  line("  status: needs review   : " + review.length + (review.length ? "   <-- resolve before wiring the engine in" : "   <-- clear"));
  line("  status: intended fixes : " + expected.length);
  line("  phase:  corrections    : " + phaseFixes.length);
  line("");
  line("Nothing was modified. The engine is not wired into any response yet.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Shadow compare failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
