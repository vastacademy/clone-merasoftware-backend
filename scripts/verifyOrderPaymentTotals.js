// READ-ONLY verification for helpers/orderPaymentTotals.js — the payment SSOT.
// Writes nothing. Proves the helper's rules hold, using in-memory cases for the rules
// themselves plus the live database for the real-world checks.
//
// Run:  node scripts/verifyOrderPaymentTotals.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const {
  sumReceivedFromTransactions,
  getOrderAmountReceived,
  getInvoiceAmountReceived,
  deriveInvoiceStatus,
} = require("../helpers/orderPaymentTotals");

let passed = 0;
let failed = 0;
const check = (name, actual, expected) => {
  const ok = Math.abs(Number(actual) - Number(expected)) <= 0.01 || actual === expected;
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name} — expected ${expected}, got ${actual}`); }
};

const main = async () => {
  console.log("RULE CHECKS (in-memory)");
  check("pending money never counts", sumReceivedFromTransactions([{ status: "pending", type: "payment", amount: 1500 }]), 0);
  check("completed payment counts", sumReceivedFromTransactions([{ status: "completed", type: "payment", amount: 1500 }]), 1500);
  check("refund subtracts", sumReceivedFromTransactions([
    { status: "completed", type: "payment", amount: 1500 },
    { status: "completed", type: "refund", amount: 500 },
  ]), 1000);
  check("deposit (wallet recharge) never counts", sumReceivedFromTransactions([{ status: "completed", type: "deposit", amount: 5000 }]), 0);
  check("renewal never counts toward the order", sumReceivedFromTransactions([{ status: "completed", type: "renewal", amount: 3000 }]), 0);
  check("rejected money never counts", sumReceivedFromTransactions([{ status: "rejected", type: "payment", amount: 900 }]), 0);
  check("combined wallet+UPI: only the settled leg counts", sumReceivedFromTransactions([
    { status: "completed", type: "payment", amount: 664.1 },
    { status: "pending", type: "payment", amount: 1835.9 },
  ]), 664.1);
  check("empty list is zero", sumReceivedFromTransactions([]), 0);

  console.log("");
  console.log("STATUS DERIVATION");
  check("nothing paid -> unpaid", deriveInvoiceStatus(0, 1500), "unpaid");
  check("part paid -> partially_paid", deriveInvoiceStatus(664.1, 2500), "partially_paid");
  check("fully paid -> paid", deriveInvoiceStatus(1500, 1500), "paid");
  check("overpaid -> paid", deriveInvoiceStatus(1600, 1500), "paid");

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { console.log("\nNo Mongo URI — skipping live checks."); process.exit(failed ? 1 : 0); }
  await mongoose.connect(uri);

  console.log("");
  console.log("LIVE DATA CHECKS");

  // No order may report more received than a real payment log can justify.
  const orders = await orderProductModel.find({}).select("_id totalAmount price isServicePlan").lean();
  let overReported = 0;
  for (const order of orders) {
    const received = await getOrderAmountReceived(order._id);
    const total = Number(order.totalAmount ?? order.price ?? 0);
    if (total > 0 && received > total + 0.01) overReported += 1;
  }
  check("no order reports more received than its own total", overReported, 0);

  // A pending payment must leave its invoice with room to settle — this is the exact
  // condition that was broken (invoice PAID while its payment was still pending).
  const pendingWithInvoice = await transactionModel.find({ status: "pending", invoiceId: { $ne: null } }).lean();
  let unapprovable = 0;
  for (const txn of pendingWithInvoice) {
    const invoice = await invoiceModel.findById(txn.invoiceId).lean();
    if (!invoice) continue;
    const outstanding = Number(invoice.amount || 0) - Number(invoice.amountPaid || 0);
    if (Number(txn.amount || 0) > outstanding + 0.01) unapprovable += 1;
  }
  check("every pending payment is still approvable", unapprovable, 0);

  // An invoice must never be credited for money that has not completed.
  let creditedPending = 0;
  const paidInvoices = await invoiceModel.find({ amountPaid: { $gt: 0 } }).select("_id amountPaid").lean();
  for (const invoice of paidInvoices) {
    const linked = await transactionModel.find({ invoiceId: invoice._id }).select("amount status type").lean();
    if (!linked.length) continue; // historical invoices are joined by orderId, not invoiceId
    const received = await getInvoiceAmountReceived(invoice._id);
    if (Number(invoice.amountPaid || 0) > received + 0.01) creditedPending += 1;
  }
  check("no invoice is credited for uncompleted money", creditedPending, 0);

  await mongoose.disconnect();
  console.log("");
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error("Verification error:", e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
