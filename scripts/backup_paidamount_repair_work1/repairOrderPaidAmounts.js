// Repairs order.paidAmount / order.remainingAmount so they agree with the money the order
// actually received.
//
// WHY THIS EXISTS
// paidAmount is maintained BY HAND in nine different places (order creation, wallet-instant pay,
// transaction approval, rejection, refunds, service-cycle settlement, …), each doing its own
// `+=` / `-=` / clamp. Any path that was missed, or threw halfway, leaves the stored number
// disagreeing with the transactions that are the real record of money. Eleven orders currently
// disagree: nine sit at the schema default 0 despite being fully paid, one reads 40000 against
// 28000 actually received, and one is refund-owned (see the skip rule below).
//
// This matters beyond display: installment progress and "how much is still due" are computed
// from paidAmount, so a wrong number becomes a wrong demand made to a real customer.
//
// scripts/repairLegacyOrderStatusFacts.js deliberately left this alone — it is a MONEY change,
// not a status change, with different risk and different verification. This script is that
// separately-tracked repair.
//
// THE RULE — never guessed, always derived
// The correct figure comes from getOrderAmountReceived() (helpers/orderPaymentTotals.js), the
// existing single source of truth for "how much has this order received". It already encodes the
// rules a fresh implementation would get wrong: only `completed` transactions count, `refund`
// subtracts, and `deposit`/`renewal` never count toward an order's own price. It is covered by
// 15 checks in scripts/verifyOrderPaymentTotals.js. This script only ASKS it the question.
//
// remainingAmount is then derived as total - paid, using the same getOrderTotal() expression
// that helpers/orderRefundService.js, helpers/paymentRecording.js and helpers/projectFinalInvoice.js
// all use, so the repaired value matches what every other writer would have produced.
//
// EXPLICITLY EXCLUDED — refund-owned or cancelled orders. Their money is governed by
// helpers/orderRefundService.js, which adjusts paidAmount and reverses the matching invoices
// together in one flow. Rewriting paidAmount from outside that flow would desync it from the
// invoices it already reversed. One order is skipped for this reason; it is REPORTED rather than
// hidden, so this script is never mistaken for having repaired every mismatch.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairOrderPaidAmounts.js
//   node scripts/repairOrderPaidAmounts.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const { getOrderAmountReceived } = require("../helpers/orderPaymentTotals");
require("../models/productModel"); // register 'product' so populate('productId') works

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

// Same expression used by helpers/orderRefundService.js, helpers/paymentRecording.js and
// helpers/projectFinalInvoice.js — remainingAmount must be derived the way its other writers do.
const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

// An order the refund system owns, or one that is terminally cancelled. Its paidAmount belongs
// to helpers/orderRefundService.js. Mirrors the predicate in repairLegacyOrderStatusFacts.js.
const isRefundOwnedOrCancelled = (order) =>
  order.orderVisibility === "cancelled" ||
  order.status === "cancelled" ||
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
  line("scope: paidAmount + remainingAmount only");
  line("");

  const orders = await orderProductModel
    .find({})
    .select("price totalAmount totalPrice paidAmount remainingAmount orderVisibility status refunds refundTotal isPartialPayment installments projectSnapshot productId servicePlanSnapshot createdAt")
    .populate("productId", "serviceName")
    .lean();

  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName || o.servicePlanSnapshot?.serviceName || "(unnamed)";

  // Reported in three buckets, because the harm differs by direction: an understated order gets
  // demanded from again, an overstated one under-collects or mis-refunds.
  const understated = [];
  const overstated = [];
  const skipped = [];
  let alreadyCorrect = 0;

  for (const order of orders) {
    const received = money(await getOrderAmountReceived(order._id));
    const stored = money(order.paidAmount);
    if (Math.abs(received - stored) < 0.01) {
      alreadyCorrect++;
      continue;
    }

    const total = money(getOrderTotal(order));
    const row = {
      order,
      name: nameOf(order),
      total,
      stored,
      received,
      storedRemaining: money(order.remainingAmount),
      newRemaining: money(Math.max(0, total - received)),
    };

    if (isRefundOwnedOrCancelled(order)) skipped.push(row);
    else if (received > stored) understated.push(row);
    else overstated.push(row);
  }

  const report = (title, rows, note) => {
    sep();
    line(title + " : " + rows.length + " order(s)");
    if (note) line("  " + note);
    rows.forEach((r) => {
      line("");
      line("  ORDER " + r.order._id + "   " + r.name);
      line("    created        : " + new Date(r.order.createdAt).toISOString().slice(0, 10));
      line("    order total    : " + r.total +
           (r.order.isPartialPayment ? "   (partial, " + (r.order.installments || []).length + " installments)" : ""));
      line("    paidAmount     : " + r.stored + "  ->  " + r.received);
      line("    remainingAmount: " + r.storedRemaining + "  ->  " + r.newRemaining);
    });
  };

  report("UNDERSTATED (stored < money received)", understated,
    "harm: order looks unpaid, customer can be asked to pay again");
  report("OVERSTATED (stored > money received)", overstated,
    "harm: order looks more paid than it is, under-collects or mis-refunds");
  report("SKIPPED — refund-owned or cancelled", skipped,
    "not repaired here: helpers/orderRefundService.js owns this money");

  const toWrite = [...understated, ...overstated];
  if (APPLY) {
    for (const r of toWrite) {
      await orderProductModel.updateOne(
        { _id: r.order._id },
        { $set: { paidAmount: r.received, remainingAmount: r.newRemaining } }
      );
    }
  }

  sep();
  line("");
  line("SUMMARY");
  line("  orders scanned                     : " + orders.length);
  line("  already correct                    : " + alreadyCorrect);
  line("  understated (would be repaired)    : " + understated.length);
  line("  overstated  (would be repaired)    : " + overstated.length);
  line("  skipped (refund-owned / cancelled) : " + skipped.length);
  line("  total repaired                     : " + (APPLY ? toWrite.length : 0));
  line("");
  line(APPLY
    ? "APPLIED. Run scripts/verifyOrderPaymentTotals.js and scripts/verifyPaymentSsotFlows.js, then re-run this script — it should report 0 to repair."
    : "DRY-RUN complete — nothing was written. Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
