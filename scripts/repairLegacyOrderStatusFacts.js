// PHASE 1 of the order-status SSOT work. Repairs the one stored fact the status surfaces read
// that no code path has ever written: orderVisibility.
//
// Background (measured by scripts/readOnlyAuditOrderStatusSsot.js against live data):
//   12 orders carry orderVisibility 'visible'. Nothing in this codebase ever WRITES that value —
//   grep confirms the only occurrences are the schema default in models/orderProductModel.js and
//   two read-side allowlists (getOrderDetails.js, partnerCustomers.js) that accept it. These
//   orders were created before/outside the approval paths and never transitioned.
//
//   That default is what splits the two sides apart. The customer derivation
//   (frontend/src/helpers/orderPresentation.js) treats 'visible' as approved via isOrderApproved();
//   the admin derivation (AdminClientWorkspace.js / getAdminUserWorkspace.js) does not read
//   orderVisibility for that case at all and falls through to `status`, which for these orders
//   still holds whatever it was created with. Five of the eleven customer-vs-admin disagreements
//   in the audit come from exactly this.
//
// SCOPE IS DELIBERATELY LIMITED TO orderVisibility.
// An earlier draft of this script also rewrote paidAmount/remainingAmount from
// helpers/orderPaymentTotals.js, because the same 11 orders also carry a paidAmount that
// disagrees with their completed transactions (nine read 0 despite full payment; one reads 40000
// against a 12000 order). That is a real bug, but it is a MONEY bug, not a status bug — the
// status engine only needs the correct value to exist, not for the whole field to be re-derived.
// Mixing it in here would put an accounting change inside a status fix, with different risk and
// different verification. It is tracked separately and is deliberately NOT done by this script.
//
// THE REPAIR RULE — derived from each order's own facts, never guessed:
//   money received > 0  ->  'approved'   (a payment landed; that is what approval means here)
//   money received = 0  ->  left as-is   (no evidence of payment; not this script's call)
// "Money received" is read through getOrderAmountReceived() (helpers/orderPaymentTotals.js), the
// existing single source of truth for that question — it is covered by 15 checks in
// scripts/verifyOrderPaymentTotals.js and already encodes the rules a fresh implementation would
// get wrong, notably that `renewal` transactions do NOT count toward an order's own price. One
// service order here carries 5 renewals of 3000 against a 3000 price; a naive sum would read
// 18000. The helper is used only to ASK the question, not to write paidAmount.
//
// This changes no gate: isOrderApproved() (frontend/src/helpers/orderVisibility.js) and the
// backend's approved allowlists already treat 'visible' and 'approved' identically. It only
// removes the schema-default value that the admin-side derivation cannot interpret.
//
// EXPLICITLY EXCLUDED — refund-owned orders (cancelled, or carrying refunds). Their money is
// governed by helpers/orderRefundService.js, and a cancelled order must never be moved back to
// 'approved' (helpers/orderLifecycle.js makes 'cancelled' terminal for exactly this reason).
//
// NOT REPAIRED HERE (out of scope by design):
//   - order.status / currentPhase — these belong to the status engine, not to a data patch.
//   - paidAmount / remainingAmount — see the scope note above.
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

// An order the refund system owns, or one that is terminally cancelled. Never re-approved.
const isRefundOwnedOrCancelled = (order) =>
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
  line("scope: orderVisibility only — paidAmount is deliberately NOT touched");
  line("");

  // Only the orders carrying the schema default. Everything else is already in a real state.
  const orders = await orderProductModel
    .find({ orderVisibility: "visible" })
    .select("price totalAmount paidAmount orderVisibility status projectProgress currentPhase refunds refundTotal projectSnapshot productId servicePlanSnapshot createdAt")
    .populate("productId", "serviceName")
    .lean();

  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName || o.servicePlanSnapshot?.serviceName || "(unnamed)";

  let repaired = 0;
  let leftAlone = 0;
  let skippedRefund = 0;

  for (const order of orders) {
    const received = money(await getOrderAmountReceived(order._id));

    sep();
    line("ORDER " + order._id + "   " + nameOf(order));
    line("  created           : " + new Date(order.createdAt).toISOString().slice(0, 10));
    line("  money received    : " + received + "   (order price: " + money(order.price ?? order.totalAmount) + ")");
    line("  status / progress : " + order.status + " / " + (order.projectProgress ?? "-") + "%");

    if (isRefundOwnedOrCancelled(order)) {
      skippedRefund++;
      line("  => SKIPPED (refund-owned or cancelled — never re-approved)");
      continue;
    }

    if (received <= 0) {
      leftAlone++;
      line("  => LEFT AS-IS (no money received — no evidence to approve on)");
      continue;
    }

    repaired++;
    line("  => orderVisibility: visible  ->  approved");

    if (APPLY) {
      await orderProductModel.updateOne(
        { _id: order._id },
        { $set: { orderVisibility: "approved" } }
      );
    }
  }

  sep();
  line("");
  line("SUMMARY");
  line("  orders with orderVisibility 'visible' : " + orders.length);
  line("  repaired to 'approved'                : " + repaired);
  line("  left as-is (no money received)        : " + leftAlone);
  line("  skipped (refund-owned / cancelled)    : " + skippedRefund);
  line("");
  line(APPLY
    ? "APPLIED. Re-run scripts/readOnlyAuditOrderStatusSsot.js to confirm the disagreement count dropped."
    : "DRY-RUN complete — nothing was written. Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
