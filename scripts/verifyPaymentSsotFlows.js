// Self-cleaning end-to-end verification of the payment SSOT changes.
// Creates its own throwaway user/order/invoice/transactions, exercises the real helpers,
// asserts the outcome, then deletes everything it made. Touches no pre-existing record.
//
// Run:  node scripts/verifyPaymentSsotFlows.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const { markProjectInvoicePaid, reverseProjectInvoicePayment } = require("../helpers/paymentRecording");

let passed = 0, failed = 0;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected) || Math.abs(Number(actual) - Number(expected)) <= 0.01;
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name} — expected ${expected}, got ${actual}`); }
};

const made = { users: [], orders: [], invoices: [], txns: [] };

const newInvoice = async (userId, orderId, amount, tag) => {
  const invoice = await invoiceModel.create({
    userId, orderId, invoiceNumber: `SSOTTEST-${tag}-${Date.now()}`,
    invoiceType: "project", amount, status: "unpaid",
    invoiceDate: new Date(), dueDate: new Date(),
  });
  made.invoices.push(invoice._id);
  return invoice;
};

const newTxn = async (userId, orderId, invoiceId, amount, status, type = "payment") => {
  const txn = await transactionModel.create({
    userId, orderId, invoiceId,
    transactionId: `SSOTTEST${Date.now()}${Math.floor(Math.random() * 100000)}`,
    amount, status, type, sourceType: "invoice", paymentMethod: "upi", date: new Date(),
    description: "SSOT verification transaction",
  });
  made.txns.push(txn._id);
  return txn;
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { console.log("No Mongo URI in .env"); process.exit(1); }
  await mongoose.connect(uri);
  console.log("connected — creating throwaway test data\n");

  const user = await userModel.create({
    name: "SSOT Test User", email: `ssot-test-${Date.now()}@example.invalid`,
    password: "x", walletBalance: 0,
  });
  made.users.push(user._id);

  const order = await orderProductModel.create({
    userId: user._id, price: 2500, totalAmount: 2500,
    paidAmount: 0, remainingAmount: 2500, orderVisibility: "pending-approval",
  });
  made.orders.push(order._id);

  // ---- 1. The exact bug: a PENDING payment must never make an invoice look paid ----
  console.log("CASE 1 — pending payment must not settle an invoice");
  let invoice = await newInvoice(user._id, order._id, 1500, "A");
  const pendingTxn = await newTxn(user._id, order._id, invoice._id, 1500, "pending");
  await markProjectInvoicePaid({ invoice, customerId: user._id, paymentMethod: "upi", amount: 1500, existingTransaction: pendingTxn });
  let fresh = await invoiceModel.findById(invoice._id).lean();
  check("amountPaid stays 0 while payment is pending", fresh.amountPaid, 0);
  check("status stays unpaid", fresh.status, "unpaid");
  check("outstanding still covers the payment (approvable)", Number(fresh.amount) - Number(fresh.amountPaid), 1500);

  // ---- 2. Approving that same payment settles it ----
  console.log("\nCASE 2 — approving the payment settles the invoice");
  await transactionModel.updateOne({ _id: pendingTxn._id }, { $set: { status: "completed" } });
  invoice = await invoiceModel.findById(invoice._id);
  await markProjectInvoicePaid({ invoice, customerId: user._id, paymentMethod: "upi", amount: 1500, existingTransaction: pendingTxn });
  fresh = await invoiceModel.findById(invoice._id).lean();
  check("amountPaid becomes the real amount", fresh.amountPaid, 1500);
  check("status derives to paid", fresh.status, "paid");

  // ---- 3. Running it twice must not double-count (the old += drifted here) ----
  console.log("\nCASE 3 — a repeated settle is idempotent");
  invoice = await invoiceModel.findById(invoice._id);
  await markProjectInvoicePaid({ invoice, customerId: user._id, paymentMethod: "upi", amount: 1500, existingTransaction: pendingTxn });
  fresh = await invoiceModel.findById(invoice._id).lean();
  check("amountPaid not doubled", fresh.amountPaid, 1500);

  // ---- 4. Combined wallet+UPI: only the completed leg counts ----
  console.log("\nCASE 4 — combined payment counts only the settled leg");
  const invoice2 = await newInvoice(user._id, order._id, 2500, "B");
  const walletTxn = await newTxn(user._id, order._id, invoice2._id, 664.1, "completed");
  await newTxn(user._id, order._id, invoice2._id, 1835.9, "pending");
  let inv2 = await invoiceModel.findById(invoice2._id);
  await markProjectInvoicePaid({ invoice: inv2, customerId: user._id, paymentMethod: "wallet", amount: 664.1, existingTransaction: walletTxn });
  let fresh2 = await invoiceModel.findById(invoice2._id).lean();
  check("only the wallet leg is counted", fresh2.amountPaid, 664.1);
  check("status is partially_paid", fresh2.status, "partially_paid");
  check("UPI leg still has room to approve", Number(fresh2.amount) - Number(fresh2.amountPaid), 1835.9);

  // ---- 5. Rejection re-derives instead of blind subtraction ----
  console.log("\nCASE 5 — rejecting a payment reverses it exactly once");
  await transactionModel.updateOne({ _id: walletTxn._id }, { $set: { status: "rejected" } });
  inv2 = await invoiceModel.findById(invoice2._id);
  await reverseProjectInvoicePayment({ invoice: inv2, amount: 664.1 });
  fresh2 = await invoiceModel.findById(invoice2._id).lean();
  check("amountPaid back to 0", fresh2.amountPaid, 0);
  check("status back to unpaid", fresh2.status, "unpaid");
  inv2 = await invoiceModel.findById(invoice2._id);
  await reverseProjectInvoicePayment({ invoice: inv2, amount: 664.1 });
  fresh2 = await invoiceModel.findById(invoice2._id).lean();
  check("repeated reversal never goes negative", fresh2.amountPaid, 0);

  // ---- cleanup ----
  console.log("\ncleaning up test data...");
  await transactionModel.deleteMany({ _id: { $in: made.txns } });
  await invoiceModel.deleteMany({ _id: { $in: made.invoices } });
  await orderProductModel.deleteMany({ _id: { $in: made.orders } });
  await userModel.deleteMany({ _id: { $in: made.users } });
  const leftover = await transactionModel.countDocuments({ transactionId: /^SSOTTEST/ });
  check("no test data left behind", leftover, 0);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error("Verification error:", e);
  try {
    await transactionModel.deleteMany({ _id: { $in: made.txns } });
    await invoiceModel.deleteMany({ _id: { $in: made.invoices } });
    await orderProductModel.deleteMany({ _id: { $in: made.orders } });
    await userModel.deleteMany({ _id: { $in: made.users } });
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
