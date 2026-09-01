// Writes the ONE payment transaction that was never recorded for installment #1 of order
// 67e52b857f45d6d5e3eab02d (CRM Based CMS, customer Gaurav Vaid).
//
// WHAT IS ACTUALLY WRONG
// That order's three installments are all flagged paid, and its stored paidAmount of 40000 is
// CORRECT. But only two transactions exist (12000 + 16000 = 28000): the first installment's
// payment, taken on 2025-03-27, never got a transaction row — it predates the flow that writes
// one. The order's own invoice INV-202608-0013 shows the same gap: status 'paid' with a paidDate,
// but amountPaid 0 and no transaction pointing at it.
//
// So the order is not overpaid and must NOT be "repaired" downward — doing that would demand
// 12000 from a customer who already paid it. scripts/repairOrderPaidAmounts.js deliberately skips
// it for this reason. The missing piece is the RECORD, and this script writes exactly that.
//
// HOW
// Through markProjectInvoicePaid() (helpers/paymentRecording.js) — the same helper the admin
// "Record Payment" flow uses. It creates the completed transaction AND derives the invoice's
// amountPaid from the transactions pointing at it (never accumulates), so running this twice
// cannot double-count. Covered by 13 checks in scripts/verifyPaymentSsotFlows.js.
//
// paymentMethod is 'cash': the money predates the recorded UPI flow and no reference exists for
// it. Inventing a UPI reference would be worse than recording the absence of one.
//
// The transaction's `date` is set to the installment's real paidDate (2025-03-27) — when the
// money arrived — while createdAt stays today, when the record was written. The schema keeps
// both fields for exactly this reason; stamping today's date on `date` would misplace this
// payment after the two that followed it.
//
// AFTER THIS: derived money = 40000 = stored paidAmount, and the order leaves the mismatch list.
// The order's own paidAmount/remainingAmount are NOT touched — they are already right.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairMissingInstallmentTransaction.js
//   node scripts/repairMissingInstallmentTransaction.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const { markProjectInvoicePaid } = require("../helpers/paymentRecording");
const { getOrderAmountReceived } = require("../helpers/orderPaymentTotals");

// This script repairs one identified record, not a class of them. Everything it touches is named
// here so it can never wander onto another order.
const ORDER_ID = "67e52b857f45d6d5e3eab02d";
const INVOICE_NUMBER = "INV-202608-0013";
const INSTALLMENT_NUMBER = 1;
const EXPECTED_AMOUNT = 12000;
const EXPECTED_STORED_PAID = 40000;
const PAYMENT_DATE = new Date("2025-03-27T10:44:29.725Z"); // installment #1 / invoice paidDate
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
  line("scope: one payment transaction + its invoice's amountPaid");
  line("");

  sep();
  line("PRECONDITIONS — every one must hold before anything is written");

  const order = await orderProductModel.findById(ORDER_ID).lean();
  if (!guard("order exists", Boolean(order), ORDER_ID)) return finish();

  const installment = (order.installments || []).find((i) => i.installmentNumber === INSTALLMENT_NUMBER);
  guard("installment #" + INSTALLMENT_NUMBER + " exists and is flagged paid",
    Boolean(installment && installment.paid),
    installment ? "amount " + money(installment.amount) + ", paidDate " + (installment.paidDate ? new Date(installment.paidDate).toISOString().slice(0, 10) : "-") : "not found");
  guard("installment amount is " + EXPECTED_AMOUNT,
    Boolean(installment) && Math.abs(money(installment.amount) - EXPECTED_AMOUNT) < 0.01);
  guard("stored paidAmount is still " + EXPECTED_STORED_PAID + " (already correct — not touched here)",
    Math.abs(money(order.paidAmount) - EXPECTED_STORED_PAID) < 0.01,
    "found " + money(order.paidAmount));

  const invoice = await invoiceModel.findOne({ orderId: order._id, invoiceNumber: INVOICE_NUMBER });
  if (!guard("invoice " + INVOICE_NUMBER + " exists", Boolean(invoice))) return finish();
  guard("invoice is the one for installment #" + INSTALLMENT_NUMBER,
    Number(invoice.installmentNumber) === INSTALLMENT_NUMBER);
  guard("invoice amount is " + EXPECTED_AMOUNT,
    Math.abs(money(invoice.amount) - EXPECTED_AMOUNT) < 0.01);
  guard("invoice amountPaid is still 0 (the gap this repairs)",
    Math.abs(money(invoice.amountPaid)) < 0.01, "found " + money(invoice.amountPaid));

  // The decisive guard: if any transaction already points at this invoice, the money is already
  // recorded and writing another would double-count it.
  const linked = await transactionModel.countDocuments({ invoiceId: invoice._id });
  guard("no transaction points at this invoice yet", linked === 0, "found " + linked);

  const receivedBefore = money(await getOrderAmountReceived(order._id));
  guard("money currently derived from transactions is " + (EXPECTED_STORED_PAID - EXPECTED_AMOUNT),
    Math.abs(receivedBefore - (EXPECTED_STORED_PAID - EXPECTED_AMOUNT)) < 0.01,
    "found " + receivedBefore);

  line("");
  if (failed > 0) {
    sep();
    line(failed + " precondition(s) failed — nothing was written.");
    line("The record is not in the state this repair was written for. Re-check before forcing it.");
    return finish();
  }

  sep();
  line("PLANNED WRITE");
  line("  transaction : " + EXPECTED_AMOUNT + "  type payment, status completed, method cash");
  line("                date " + PAYMENT_DATE.toISOString().slice(0, 10) + " (when the money arrived)");
  line("                linked to invoice " + INVOICE_NUMBER);
  line("  invoice     : amountPaid " + money(invoice.amountPaid) + "  ->  " + EXPECTED_AMOUNT);
  line("  order       : paidAmount " + money(order.paidAmount) + "  (UNCHANGED — already correct)");
  line("  derived     : " + receivedBefore + "  ->  " + EXPECTED_STORED_PAID + "  (matches stored)");
  line("");

  if (!APPLY) {
    sep();
    line("DRY-RUN complete — nothing was written. Re-run with --apply to write.");
    return finish();
  }

  const { transaction } = await markProjectInvoicePaid({
    invoice,
    customerId: order.userId,
    paymentMethod: "cash",
    transactionReference: null,
    notes: "Backfilled record for installment 1, paid 2025-03-27. The payment was taken and the "
         + "installment and invoice were marked paid at the time, but no transaction row was "
         + "written for it. Recorded by scripts/repairMissingInstallmentTransaction.js.",
    actorId: ACTOR_ID,
    amount: EXPECTED_AMOUNT,
  });

  // markProjectInvoicePaid() stamps `date` and `paidDate` with now, which is right for a payment
  // taken now and wrong for one being backfilled. Restore both to when the money actually moved;
  // createdAt keeps saying when this record was written.
  await transactionModel.updateOne({ _id: transaction._id }, { $set: { date: PAYMENT_DATE } });
  await invoiceModel.updateOne({ _id: invoice._id }, { $set: { paidDate: PAYMENT_DATE } });

  const receivedAfter = money(await getOrderAmountReceived(order._id));
  const invoiceAfter = await invoiceModel.findById(invoice._id).lean();
  const orderAfter = await orderProductModel.findById(order._id).select("paidAmount remainingAmount").lean();

  sep();
  line("RESULT");
  line("  transaction written : " + transaction.transactionId + "   date " +
       PAYMENT_DATE.toISOString().slice(0, 10));
  line("  invoice amountPaid  : " + money(invoiceAfter.amountPaid) + "   status " + invoiceAfter.status);
  line("  order paidAmount    : " + money(orderAfter.paidAmount) +
       "   remainingAmount " + money(orderAfter.remainingAmount) + "   (untouched)");
  line("  derived from txns   : " + receivedAfter +
       (Math.abs(receivedAfter - money(orderAfter.paidAmount)) < 0.01
         ? "   MATCHES stored paidAmount" : "   STILL DISAGREES — investigate"));
  line("");
  line("APPLIED. Run scripts/verifyOrderPaymentTotals.js and scripts/verifyPaymentSsotFlows.js, "
     + "then scripts/repairOrderPaidAmounts.js — this order should no longer be listed.");
  return finish();
};

const finish = async () => {
  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
