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
const {
  getOrderAmountReceived,
  getOrderTotal,
  setOrderPaidAmount,
} = require("../helpers/orderPaymentTotals");
require("../models/productModel"); // register 'product' so populate('productId') works

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

// An order the refund system owns, or one that is terminally cancelled. Its paidAmount belongs
// to helpers/orderRefundService.js. Mirrors the predicate in repairLegacyOrderStatusFacts.js.
//
// These orders can legitimately show derived > stored, and that is NOT drift. A refund paid out
// through a non-wallet method is money the admin sent outside this system: orderRefundService.js
// records it in order.refunds[] with a referenceId and deliberately writes NO transaction
// ("Money the admin already sent outside this system. Recorded, not moved."). Only the wallet leg
// gets one. So paidAmount is net of BOTH legs while the transactions only subtract the wallet leg,
// and the difference is exactly the external legs. Writing a transaction to close that gap would
// invent a payment row no other external refund has.
const isRefundOwnedOrCancelled = (order) =>
  order.orderVisibility === "cancelled" ||
  order.status === "cancelled" ||
  (Array.isArray(order.refunds) && order.refunds.length > 0) ||
  Number(order.refundTotal || 0) > 0;

// The transactions are this script's evidence, but they are not always COMPLETE. One order here
// (CRM Based CMS) has installment #1 flagged paid with a paidDate, and its invoice marked paid —
// yet no transaction was ever written for it, because that first payment predates the flow that
// records one. Its stored paidAmount is therefore CORRECT and the transaction list is short.
//
// Writing the derived figure there would not fix an error, it would create one: a settled order
// would start demanding money the customer already paid. So when the paid installments
// corroborate the stored figure, the installments win and the order is left alone — the missing
// transaction is a separate repair, made against its invoice through the payment SSOT rather
// than by rewriting the order's total here.
const paidInstallmentTotal = (order) =>
  (Array.isArray(order.installments) ? order.installments : [])
    .reduce((sum, i) => (i?.paid ? sum + Number(i.amount || 0) : sum), 0);

const installmentsCorroborateStored = (order, stored) =>
  Boolean(order.isPartialPayment) &&
  Array.isArray(order.installments) &&
  order.installments.length > 0 &&
  Math.abs(money(paidInstallmentTotal(order)) - stored) < 0.01;

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
    // isServicePlan is what setOrderPaidAmount() reads to refuse a service order. Omitting it
    // would silently present every service as a project and rewrite its cycle-scoped paidAmount.
    .select("price totalAmount totalPrice paidAmount remainingAmount orderVisibility status refunds refundTotal isPartialPayment installments projectSnapshot productId servicePlanSnapshot isServicePlan createdAt")
    .populate("productId", "serviceName")
    .lean();

  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName || o.servicePlanSnapshot?.serviceName || "(unnamed)";

  // Reported in three buckets, because the harm differs by direction: an understated order gets
  // demanded from again, an overstated one under-collects or mis-refunds.
  const understated = [];
  const overstated = [];
  const skipped = [];
  const corroborated = [];
  const remainingOnly = [];
  let alreadyCorrect = 0;
  let notOurs = 0;

  for (const order of orders) {
    // setOrderPaidAmount() is the writer the payment paths are being moved onto, so the repair
    // must ask IT what the order should hold — otherwise the script and the runtime could drift
    // apart and this script would "fix" orders into a state the app then rewrites. It refuses
    // service orders (their paidAmount means a billing cycle, not the order) and nets off
    // external refund legs, both of which this script must honour identically.
    const candidate = JSON.parse(JSON.stringify(order));
    candidate._id = order._id;
    if (!(await setOrderPaidAmount(candidate))) {
      notOurs++;
      continue;
    }

    const received = money(candidate.paidAmount);
    const stored = money(order.paidAmount);
    const storedRemaining = money(order.remainingAmount);
    const correctRemaining = money(candidate.remainingAmount);

    if (Math.abs(received - stored) < 0.01) {
      // paidAmount is right; remainingAmount can still be stale — nine orders were created with
      // the schema default 0 and never had it written. Nothing is owed to the customer here, but
      // an order with money outstanding reads as fully settled, which is the same class of lie.
      if (Math.abs(correctRemaining - storedRemaining) >= 0.01) {
        remainingOnly.push({
          order,
          name: nameOf(order),
          total: money(getOrderTotal(order)),
          stored,
          received,
          storedRemaining,
          newRemaining: correctRemaining,
        });
      } else {
        alreadyCorrect++;
      }
      continue;
    }

    const total = money(getOrderTotal(order));
    const row = {
      order,
      name: nameOf(order),
      total,
      stored,
      received,
      storedRemaining,
      newRemaining: correctRemaining,
    };

    if (isRefundOwnedOrCancelled(order)) {
      row.refundOwned = true;
      skipped.push(row);
    } else if (installmentsCorroborateStored(order, stored)) {
      row.installmentEvidence = money(paidInstallmentTotal(order));
      corroborated.push(row);
    } else if (received > stored) understated.push(row);
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
      if (r.refundOwned) {
        const external = (r.order.refunds || [])
          .filter((x) => x && x.method !== "wallet")
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        line("    refundTotal    : " + money(r.order.refundTotal) +
             "   of which paid out externally: " + money(external) + " (no transaction, by design)");
        line("    money in transactions : " + r.received + "   vs stored " + r.stored +
             "   difference " + money(r.received - r.stored));
        line("    paidAmount     : " + r.stored + "  (LEFT AS-IS)");
      } else if (r.installmentEvidence != null) {
        line("    paid installments total : " + r.installmentEvidence + "  (matches stored paidAmount)");
        line("    money in transactions   : " + r.received + "   <- short by " +
             money(r.stored - r.received) + ", a transaction was never written");
        line("    paidAmount     : " + r.stored + "  (LEFT AS-IS)");
      } else {
        line("    paidAmount     : " + r.stored + "  ->  " + r.received);
        line("    remainingAmount: " + r.storedRemaining + "  ->  " + r.newRemaining);
      }
    });
  };

  report("UNDERSTATED (stored < money received)", understated,
    "harm: order looks unpaid, customer can be asked to pay again");
  report("OVERSTATED (stored > money received)", overstated,
    "harm: order looks more paid than it is, under-collects or mis-refunds");
  report("SKIPPED — refund-owned or cancelled", skipped,
    "expected: an external refund leg (upi/bank) is recorded in order.refunds[] with a "
    + "referenceId and NO transaction, by design — so derived money reads higher than stored");
  report("SKIPPED — paid installments corroborate the stored figure", corroborated,
    "stored paidAmount is correct; the TRANSACTION is what is missing (separate repair)");
  report("REMAINING-AMOUNT ONLY (paidAmount is already right)", remainingOnly,
    "harm: an order with money still owed reads as fully settled");

  const toWrite = [...understated, ...overstated, ...remainingOnly];
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
  line("  not owned by this rule (services)  : " + notOurs);
  line("  already correct                    : " + alreadyCorrect);
  line("  understated (would be repaired)    : " + understated.length);
  line("  overstated  (would be repaired)    : " + overstated.length);
  line("  remaining-amount only              : " + remainingOnly.length);
  line("  skipped (refund-owned / cancelled) : " + skipped.length);
  line("  skipped (installments corroborate) : " + corroborated.length);
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
