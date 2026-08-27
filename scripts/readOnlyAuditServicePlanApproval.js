// READ-ONLY audit script. Does not write/update/delete anything.
// Purpose: diagnose the reported service-plan approval bugs, WITHOUT assuming a cause:
//   (a) combined (wallet+UPI) purchase — admin sees no "Review Payment" for the UPI part.
//   (b) UPI-only purchase — "Review Payment" appears but approving it fails.
//   (c) full-wallet purchase — no review needed (expected; verify it really auto-approves).
//
// It reads each service order's real transactions + invoice and REPLAYS (in memory only) the
// exact guard in controller/user/transactionApprovalController.js's applyApprovedOrderPayment:
//     outstanding = invoice.amount - invoice.amountPaid
//     if (txn.amount <= 0 || txn.amount > outstanding) -> throw "exceeds the invoice balance"
// so we can see whether that guard would actually throw for a real pending UPI transaction,
// instead of reasoning about it.
//
// Run:  node scripts/readOnlyAuditServicePlanApproval.js [orderId]
//   - with an orderId: audits exactly that service order.
//   - without: audits the most recent service-plan orders.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
require("../models/productModel"); // register 'product' so populate('productId') works

const LIMIT = Number(process.env.AUDIT_LIMIT || 5);

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => `₹${Number(v || 0)}`;

const auditOneOrder = async (order) => {
  sep();
  line(`ORDER ${order._id}`);
  line(`  name              : ${order.servicePlanSnapshot?.serviceName || order.productId?.serviceName || "(unnamed)"}`);
  line(`  isServicePlan     : ${order.isServicePlan}`);
  line(`  price/total       : ${money(order.price ?? order.totalAmount)}`);
  line(`  paidAmount        : ${money(order.paidAmount)}   remainingAmount: ${money(order.remainingAmount)}`);
  line(`  paymentComplete   : ${order.paymentComplete}`);
  line(`  orderVisibility   : ${order.orderVisibility}`);
  line(`  status            : ${order.status}`);
  line(`  servicePlanStatus : ${order.servicePlanStatus}`);
  line(`  createdAt         : ${order.createdAt}`);

  // ---- invoices on this order (service invoices live on invoiceModel) ----
  const invoices = await invoiceModel.find({ orderId: order._id }).lean();
  line("");
  line(`  INVOICES (invoiceModel): ${invoices.length}`);
  invoices.forEach((inv) => {
    line(`    - ${inv.invoiceNumber || inv._id}`);
    line(`        invoiceType : ${inv.invoiceType}`);
    line(`        amount      : ${money(inv.amount)}   amountPaid: ${money(inv.amountPaid)}`);
    line(`        status      : ${inv.status}`);
    line(`        cycleNumber : ${inv.serviceCycleNumber ?? "-"}`);
  });

  // ---- transactions on this order ----
  const txns = await transactionModel.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
  line("");
  line(`  TRANSACTIONS: ${txns.length}   <-- combined purchase should have TWO (wallet + UPI)`);
  txns.forEach((t) => {
    line(`    - transactionId      : ${t.transactionId}`);
    line(`        amount           : ${money(t.amount)}`);
    line(`        paymentMethod    : ${t.paymentMethod}`);
    line(`        type/sourceType  : ${t.type} / ${t.sourceType}`);
    line(`        status           : ${t.status}        <-- admin UI shows "Review Payment" only when "pending"`);
    line(`        invoiceId        : ${t.invoiceId || "(none)"}`);
    line(`        parentTransaction: ${t.parentTransactionId || "(none)"}`);
  });

  // ---- what the admin UI would render ----
  const pending = txns.filter((t) => t.status === "pending");
  line("");
  line(`  ADMIN UI: pending transaction rows with a Review button = ${pending.length}`);
  if (pending.length === 0) {
    const hasUpi = txns.some((t) => t.paymentMethod === "upi");
    line(`    -> no Review button shown. UPI transaction exists at all? ${hasUpi ? "YES" : "NO"}`);
    if (!hasUpi && txns.length > 0) {
      line("    -> ROOT CAUSE CANDIDATE: the UPI leg was never created (not a UI/guard problem).");
    }
  }

  // ---- replay the approval guard for each pending transaction ----
  line("");
  line("  APPROVAL GUARD REPLAY (no writes):");
  if (pending.length === 0) {
    line("    (nothing pending to approve)");
  }
  for (const t of pending) {
    const inv = t.invoiceId ? await invoiceModel.findById(t.invoiceId).lean() : null;
    if (!inv) {
      line(`    - ${t.transactionId}: no invoiceModel invoice on the transaction`);
      line("        -> would skip the invoice branch (isInvoiceTransaction false or invoice missing)");
      continue;
    }
    const outstanding = Math.max(0, Number(inv.amount || 0) - Number(inv.amountPaid || 0));
    const amt = Number(t.amount || 0);
    const wouldThrow = amt <= 0 || amt > outstanding;
    line(`    - ${t.transactionId}`);
    line(`        invoice.amount     : ${money(inv.amount)}`);
    line(`        invoice.amountPaid : ${money(inv.amountPaid)}   (wallet part settled at purchase)`);
    line(`        outstanding        : ${money(outstanding)}`);
    line(`        txn.amount         : ${money(amt)}`);
    line(`        RESULT             : ${wouldThrow ? "THROWS -> \"Transaction amount exceeds the invoice balance\"" : "passes guard OK"}`);
  }
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }
  await mongoose.connect(uri);
  line("connected (read-only audit — this script never writes)");

  const argId = process.argv[2];
  let orders;
  if (argId) {
    orders = await orderProductModel.find({ _id: argId }).populate("productId", "serviceName").lean();
  } else {
    orders = await orderProductModel
      .find({ isServicePlan: true })
      .sort({ createdAt: -1 })
      .limit(LIMIT)
      .populate("productId", "serviceName")
      .lean();
  }

  if (!orders.length) {
    line("No service-plan orders found.");
  } else {
    line(`Auditing ${orders.length} service order(s).`);
    for (const order of orders) await auditOneOrder(order);
  }

  sep();
  await mongoose.disconnect();
  line("done (nothing was modified)");
};

main().catch(async (error) => {
  console.error("Audit failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
