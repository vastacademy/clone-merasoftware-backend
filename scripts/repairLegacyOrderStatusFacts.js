// Repairs the legacy orders whose stored payment/visibility facts never got written by any
// real payment or approval path, so every status surface derives the wrong answer from them.
//
// Background (measured by scripts/readOnlyAuditOrderStatusSsot.js against live data):
//   - 12 orders carry orderVisibility 'visible'. Nothing in the codebase ever WRITES that
//     value — it is only the schema default (models/orderProductModel.js). These orders were
//     created before/outside the approval paths and never transitioned.
//   - 11 orders carry a paidAmount that disagrees with their completed transactions: 9 read 0
//     despite fully-paid transactions, and one reads 40000 against a 12000 order.
//   - The two sets are the same orders. One cause, not two: these orders never went through a
//     path that maintains those fields by hand.
//
// The fix is NOT a new derivation. helpers/orderPaymentTotals.js already owns "how much money
// has this order actually received" (getOrderAmountReceived), is covered by 15 checks in
// scripts/verifyOrderPaymentTotals.js, and already encodes the rules a fresh implementation
// would get wrong — notably that `renewal` transactions do NOT count toward the order's own
// price. One service order here carries 5 renewals of 3000 against a 3000 price; summing them
// naively would report it as 18000 received. This script calls that helper and writes nothing
// it did not derive from it.
//
// SCOPE IS DELIBERATELY NARROW. Only orders whose stored paidAmount disagrees with the helper,
// and only the fields below. Everything else on the order is untouched.
//
// EXPLICITLY EXCLUDED — orders that have been refunded (any refunds[] entry, or cancelled).
// Refund accounting is owned by helpers/orderRefundService.js, which tracks refundable as
// (totalPaid - alreadyRefunded) and legs per payment method. The one cancelled order in this
// data reads paidAmount 570 vs a derived 1200 precisely BECAUSE it was refunded — that gap is
// correct bookkeeping, not drift, and overwriting it would corrupt the refund record.
//
// VISIBILITY REPAIR RULE — derived from each order's own facts, never guessed:
//   money received > 0  ->  'approved'   (a payment landed; that is what approval means here)
//   money received = 0  ->  left as-is   (no evidence of payment; not this script's call)
// 'visible' and 'approved' are already treated identically by isOrderApproved()
// (frontend/src/helpers/orderVisibility.js) and by the backend's approved allowlists, so this
// changes no gate — it only removes the schema-default value that the admin-side derivation
// (AdminClientWorkspace.js) cannot interpret.
//
// NOT REPAIRED HERE (out of scope by design):
//   - order.status / currentPhase — these belong to the status engine, not to a data patch.
//   - remainingAmount — derived by each payment path from paidAmount; recomputed here only
//     where paidAmount itself changes, using the same Math.max(0, total - paid) those paths use.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairLegacyOrderStatusFacts.js
//   node scripts/repairLegacyOrderStatusFacts.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const { getOrderAmountReceived } = require("../helpers/orderPaymentTotals");
require("../models/productModel"); // register 'product' so populate('productId') works

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

// Same total the payment paths use (price is the order's own price; totalAmount is the legacy
// field some older orders carry instead).
const getOrderTotal = (order) => Number(order.price ?? order.totalAmount ?? 0);

// An order the refund system owns. Its paidAmount is intentionally net of refunds, so the
// derived-from-transactions figure will legitimately differ.
const isRefundOwned = (order) =>
  order.orderVisibility === "cancelled" ||
  (Array.isArray(order.refunds) && order.refunds.length > 0) ||
  Number(order.refundTotal || 0) > 0;

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }

  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);
  await mongoose.connect(uri);
  line(APPLY ? "MODE: APPLY (will write)" : "MODE: DRY-RUN (no writes)");
  line("");

  const orders = await orderProductModel
    .find({})
    .select("price totalAmount paidAmount remainingAmount orderVisibility status projectProgress refunds refundTotal projectSnapshot productId servicePlanSnapshot")
    .populate("productId", "serviceName")
    .lean();

  let scanned = 0;
  let skippedRefund = 0;
  let repaired = 0;
  let visibilityOnly = 0;
  const planned = [];

  for (const order of orders) {
    scanned++;

    const derived = money(await getOrderAmountReceived(order._id));
    const stored = money(order.paidAmount);
    const needsPaid = derived !== stored;
    const needsVisibility = order.orderVisibility === "visible" && derived > 0;

    if (!needsPaid && !needsVisibility) continue;

    if (isRefundOwned(order)) {
      skippedRefund++;
      planned.push({
        order,
        skip: true,
        reason: "refund-owned (helpers/orderRefundService.js) — paidAmount is net of refunds by design",
        stored,
        derived,
      });
      continue;
    }

    const total = getOrderTotal(order);
    const change = {
      order,
      skip: false,
      stored,
      derived,
      paidChanges: needsPaid,
      visibilityChanges: needsVisibility,
      fromVisibility: order.orderVisibility,
      newRemaining: needsPaid ? Math.max(0, total - derived) : null,
      oldRemaining: money(order.remainingAmount),
      total,
    };
    planned.push(change);

    if (needsPaid) repaired++;
    else visibilityOnly++;

    if (APPLY) {
      const update = {};
      if (needsPaid) {
        update.paidAmount = derived;
        update.remainingAmount = Math.max(0, total - derived);
      }
      if (needsVisibility) update.orderVisibility = "approved";
      await orderProductModel.updateOne({ _id: order._id }, { $set: update });
    }
  }

  // ---- report ----
  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName || o.servicePlanSnapshot?.serviceName || "(unnamed)";

  for (const p of planned) {
    sep();
    line("ORDER " + p.order._id + "   " + nameOf(p.order));
    if (p.skip) {
      line("  SKIPPED: " + p.reason);
      line("    stored paidAmount : " + p.stored);
      line("    derived from txns : " + p.derived + "   (difference is the refund)");
      continue;
    }
    line("  order total       : " + p.total);
    if (p.paidChanges) {
      line("  paidAmount        : " + p.stored + "  ->  " + p.derived);
      line("  remainingAmount   : " + p.oldRemaining + "  ->  " + p.newRemaining);
    } else {
      line("  paidAmount        : " + p.stored + "   (already correct, unchanged)");
    }
    if (p.visibilityChanges) {
      line("  orderVisibility   : " + p.fromVisibility + "  ->  approved   (money received: " + p.derived + ")");
    } else if (p.order.orderVisibility === "visible") {
      line("  orderVisibility   : visible   (left as-is — no money received, no evidence to approve on)");
    }
  }

  sep();
  line("");
  line("SUMMARY");
  line("  orders scanned                    : " + scanned);
  line("  paidAmount/remaining repaired     : " + repaired);
  line("  visibility-only repaired          : " + visibilityOnly);
  line("  skipped (refund-owned)            : " + skippedRefund);
  line("");
  line(APPLY
    ? "APPLIED. Re-run scripts/verifyOrderPaymentTotals.js and scripts/readOnlyAuditOrderStatusSsot.js to confirm."
    : "DRY-RUN complete — nothing was written. Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
