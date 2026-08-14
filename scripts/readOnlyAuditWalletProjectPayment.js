// READ-ONLY audit script. Does not write/update/delete anything.
// Purpose: diagnose the reported bug — a customer-created (customize flow) project paid FULLY
// from wallet ended up (a) in pending-approval, (b) sent to admin for approval, and (c) with 2
// invoices (one paid, one pending). Code review says full-wallet should auto-approve with ONE
// unpaid invoice, so we read the real order + its invoices (BOTH models) + its transactions to
// see what actually happened.
//
// Run:  node scripts/readOnlyAuditWalletProjectPayment.js [orderId]
//   - with an orderId: audits exactly that order.
//   - without: audits the most recent isWebsiteProject order(s).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel"); // NEW project invoices (invoiceType:'project')
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel"); // recurring-plan invoices
const transactionModel = require("../models/transactionModel");
const userModel = require("../models/userModel");
require("../models/productModel"); // register 'product' schema so populate('productId') works

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(72));

const auditOneOrder = async (order) => {
  sep();
  line(`ORDER  _id=${order._id}`);
  line(`  serviceName        : ${order.productId?.serviceName || order.serviceName || "(n/a)"}`);
  line(`  userId             : ${order.userId?._id || order.userId} (${order.userId?.email || "?"})`);
  line(`  isWebsiteProject   : ${order.isWebsiteProject}`);
  line(`  orderVisibility    : ${order.orderVisibility}`);
  line(`  status             : ${order.status}`);
  line(`  isPartialPayment   : ${order.isPartialPayment}`);
  line(`  paymentComplete    : ${order.paymentComplete}`);
  line(`  totalAmount        : ${order.totalAmount}`);
  line(`  paidAmount         : ${order.paidAmount}`);
  line(`  remainingAmount    : ${order.remainingAmount}`);
  line(`  createdAt          : ${order.createdAt}`);
  if (Array.isArray(order.installments) && order.installments.length) {
    line(`  installments (${order.installments.length}):`);
    order.installments.forEach((i) =>
      line(
        `     #${i.installmentNumber}  amount=${i.amount}  paid=${i.paid}  paymentStatus=${i.paymentStatus}  txn=${i.transactionId || "-"}`
      )
    );
  } else {
    line(`  installments       : (none — full payment)`);
  }

  // --- Invoices in BOTH models for this order ---
  const projectInvoices = await invoiceModel
    .find({ orderId: order._id })
    .select("_id invoiceNumber invoiceType amount status installmentNumber invoiceDate dueDate paidDate paymentMethod")
    .lean();
  const monthlyInvoices = await monthlyInvoiceModel
    .find({ orderId: order._id })
    .select("_id invoiceNumber amount status invoiceDate dueDate paidDate paymentMethod")
    .lean();

  line("");
  line(`  invoiceModel (NEW project invoices) for this order: ${projectInvoices.length}`);
  projectInvoices.forEach((inv) =>
    line(
      `     ${inv.invoiceNumber}  amount=${inv.amount}  status=${inv.status}  instNo=${inv.installmentNumber ?? "-"}  method=${inv.paymentMethod || "-"}  _id=${inv._id}`
    )
  );
  line(`  monthlyInvoiceModel (recurring invoices) for this order: ${monthlyInvoices.length}`);
  monthlyInvoices.forEach((inv) =>
    line(
      `     ${inv.invoiceNumber}  amount=${inv.amount}  status=${inv.status}  method=${inv.paymentMethod || "-"}  _id=${inv._id}`
    )
  );

  // --- Transactions for this order ---
  const txns = await transactionModel
    .find({ orderId: order._id })
    .select("transactionId amount type status paymentMethod sourceType invoiceId parentTransactionId installmentNumber date")
    .sort({ date: 1 })
    .lean();
  line("");
  line(`  transactions for this order: ${txns.length}`);
  txns.forEach((t) =>
    line(
      `     ${t.transactionId}  amt=${t.amount}  type=${t.type}  status=${t.status}  method=${t.paymentMethod}  source=${t.sourceType || "-"}  parent=${t.parentTransactionId || "-"}  invId=${t.invoiceId || "-"}`
    )
  );

  // --- Wallet balance of the owner (for context) ---
  const owner = await userModel.findById(order.userId?._id || order.userId).select("email walletBalance").lean();
  line("");
  line(`  owner walletBalance now: ${owner?.walletBalance}`);
};

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const argId = process.argv[2];
  let orders;
  if (argId && mongoose.Types.ObjectId.isValid(argId)) {
    orders = await orderProductModel.find({ _id: argId }).populate("userId", "email").populate("productId", "serviceName");
  } else {
    line("(no valid orderId arg — auditing the 5 most recent isWebsiteProject orders)");
    orders = await orderProductModel
      .find({ isWebsiteProject: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("userId", "email")
      .populate("productId", "serviceName");
  }

  line(`\n=== Orders to audit: ${orders.length} ===`);
  for (const order of orders) {
    await auditOneOrder(order);
  }

  sep();
  line("\nDone (read-only, nothing was modified).");
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("Audit failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
