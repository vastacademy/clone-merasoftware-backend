// Writes the payment record for order 67ca900eb74653ac7d14d96a (College Website, SLN College
// <slnaycollege@gmail.com>) — a 30000 project that was paid in full by bank transfer on
// 2024-07-07 but was never recorded anywhere in the system.
//
// WHAT IS ACTUALLY WRONG
// The order carries no transaction at all, its invoice INV-202608-0006 still reads 'unpaid' with
// amountPaid 0, and paidAmount is 0 — yet the project was delivered (status 'completed') and the
// money was received. Every stored field agrees with every other one, which is why no repair
// script flagged it: nothing here is INTERNALLY inconsistent, the records are simply absent.
//
// This is the opposite shape to scripts/repairMissingInstallmentTransaction.js (CRM Based CMS).
// There, the installments and the invoice were both marked paid and only the transaction row was
// missing, so the system itself evidenced the payment. Here there is no such evidence — the
// payment is attested by the business, not by the data. That is why this is a separate, explicitly
// named script rather than another case inside a general repair: it writes money on human
// authority, and must never be mistaken for a derivation from existing records.
//
// HOW
// Through markProjectInvoicePaid() (helpers/paymentRecording.js) — the same helper the admin
// "Record Payment" flow uses. It creates the completed transaction AND derives the invoice's
// amountPaid from the transactions pointing at it (never accumulates), so a second run cannot
// double-count. Covered by 13 checks in scripts/verifyPaymentSsotFlows.js.
//
// The order's own paidAmount/remainingAmount are then SET through setOrderPaidAmount()
// (helpers/orderPaymentTotals.js) — the same writer the live payment paths now use — rather than
// assigned here, so this script cannot put the order into a state the application would disagree
// with.
//
// The transaction's `date` is the payment date (2024-07-07); createdAt stays today, when the
// record was written. The schema keeps both fields for exactly this reason.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairMissingCollegeWebsitePayment.js
//   node scripts/repairMissingCollegeWebsitePayment.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const { markProjectInvoicePaid } = require("../helpers/paymentRecording");
const { getOrderAmountReceived, setOrderPaidAmount } = require("../helpers/orderPaymentTotals");
require("../models/userModel"); // register 'user' so populate('userId') works

// One identified record, named in full so this can never wander onto another order.
const ORDER_ID = "67ca900eb74653ac7d14d96a";
const INVOICE_NUMBER = "INV-202608-0006";
const CUSTOMER_EMAIL = "slnaycollege@gmail.com";
const EXPECTED_AMOUNT = 30000;
const PAYMENT_METHOD = "bank_transfer";
const PAYMENT_DATE = new Date("2024-07-07T00:00:00.000Z");
const ACTOR_ID = "6a47989b56a94e02d89b7246"; // Admin User <admin@merasoftware.com>

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

let failed = 0;
const guard = (label, ok, detail) => {
  line("  " + (ok ? "OK  " : "FAIL") + "  " + label + (detail ? "   " + detail : ""));
  if (!ok) failed++;
  return ok;
};

const finish = async () => {
  await mongoose.disconnect();
};

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
  line("scope: one payment transaction, its invoice, and the order's derived totals");
  line("");

  sep();
  line("PRECONDITIONS — every one must hold before anything is written");

  const order = await orderProductModel.findById(ORDER_ID);
  if (!guard("order exists", Boolean(order), ORDER_ID)) return finish();

  await order.populate("userId", "email name");
  guard("order belongs to " + CUSTOMER_EMAIL,
    order.userId?.email === CUSTOMER_EMAIL, "found " + (order.userId?.email || "-"));
  guard("order price is " + EXPECTED_AMOUNT,
    Math.abs(money(order.totalAmount || order.price) - EXPECTED_AMOUNT) < 0.01,
    "found " + money(order.totalAmount || order.price));
  guard("order is a project, not a service plan", order.isServicePlan !== true);
  guard("order has no installments (paid as one amount)",
    !Array.isArray(order.installments) || order.installments.length === 0);
  guard("stored paidAmount is still 0 (the gap this repairs)",
    Math.abs(money(order.paidAmount)) < 0.01, "found " + money(order.paidAmount));

  const invoice = await invoiceModel.findOne({ orderId: order._id, invoiceNumber: INVOICE_NUMBER });
  if (!guard("invoice " + INVOICE_NUMBER + " exists", Boolean(invoice))) return finish();
  guard("invoice amount is " + EXPECTED_AMOUNT,
    Math.abs(money(invoice.amount) - EXPECTED_AMOUNT) < 0.01, "found " + money(invoice.amount));
  guard("invoice is still unpaid", invoice.status === "unpaid", "found " + invoice.status);

  // The decisive guard: any transaction here means the money is already recorded and a second
  // one would double-count it.
  const orderTxns = await transactionModel.countDocuments({ orderId: order._id });
  guard("order has no transactions yet", orderTxns === 0, "found " + orderTxns);
  const invoiceTxns = await transactionModel.countDocuments({ invoiceId: invoice._id });
  guard("no transaction points at this invoice yet", invoiceTxns === 0, "found " + invoiceTxns);

  line("");
  if (failed > 0) {
    sep();
    line(failed + " precondition(s) failed — nothing was written.");
    line("The record is not in the state this repair was written for. Re-check before forcing it.");
    return finish();
  }

  sep();
  line("PLANNED WRITE");
  line("  transaction : " + EXPECTED_AMOUNT + "  type payment, status completed, method " + PAYMENT_METHOD);
  line("                date " + PAYMENT_DATE.toISOString().slice(0, 10) + " (when the money arrived)");
  line("                linked to invoice " + INVOICE_NUMBER);
  line("  invoice     : amountPaid " + money(invoice.amountPaid) + "  ->  " + EXPECTED_AMOUNT +
       "   status " + invoice.status + "  ->  paid");
  line("  order       : paidAmount " + money(order.paidAmount) + "  ->  " + EXPECTED_AMOUNT);
  line("                remainingAmount " + money(order.remainingAmount) + "  ->  0");
  line("");

  if (!APPLY) {
    sep();
    line("DRY-RUN complete — nothing was written. Re-run with --apply to write.");
    return finish();
  }

  const { transaction } = await markProjectInvoicePaid({
    invoice,
    customerId: order.userId?._id || order.userId,
    paymentMethod: PAYMENT_METHOD,
    transactionReference: null,
    notes: "Backfilled record for a 30000 bank transfer received 2024-07-07. The project was "
         + "delivered and the money was received, but no transaction, invoice settlement or "
         + "paidAmount was ever recorded for it. Recorded by "
         + "scripts/repairMissingCollegeWebsitePayment.js.",
    actorId: ACTOR_ID,
    amount: EXPECTED_AMOUNT,
  });

  // markProjectInvoicePaid() stamps `date`/`paidDate` with now, which is right for a payment taken
  // now and wrong for one being backfilled. createdAt keeps saying when this record was written.
  await transactionModel.updateOne({ _id: transaction._id }, { $set: { date: PAYMENT_DATE } });
  await invoiceModel.updateOne({ _id: invoice._id }, { $set: { paidDate: PAYMENT_DATE } });

  // Derived through the same writer the live payment paths use — never assigned here.
  const fresh = await orderProductModel.findById(order._id);
  await setOrderPaidAmount(fresh);
  fresh.paymentComplete = Number(fresh.remainingAmount || 0) <= 0;
  await fresh.save();

  const receivedAfter = money(await getOrderAmountReceived(order._id));
  const invoiceAfter = await invoiceModel.findById(invoice._id).lean();

  sep();
  line("RESULT");
  line("  transaction written : " + transaction.transactionId + "   date " +
       PAYMENT_DATE.toISOString().slice(0, 10) + "   method " + PAYMENT_METHOD);
  line("  invoice amountPaid  : " + money(invoiceAfter.amountPaid) + "   status " + invoiceAfter.status);
  line("  order paidAmount    : " + money(fresh.paidAmount) +
       "   remainingAmount " + money(fresh.remainingAmount) +
       "   paymentComplete " + fresh.paymentComplete);
  line("  derived from txns   : " + receivedAfter +
       (Math.abs(receivedAfter - money(fresh.paidAmount)) < 0.01
         ? "   MATCHES stored paidAmount" : "   STILL DISAGREES — investigate"));
  line("");
  line("APPLIED. Run scripts/verifyOrderPaymentTotals.js, scripts/verifyPaymentSsotFlows.js and "
     + "scripts/readOnlyShadowCompareOrderPaidAmount.js — all should stay clean.");
  return finish();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
