/**
 * READ-ONLY — no writes. Diagnoses why the "Add a Service" card is or isn't
 * rendering for one specific order, by evaluating the exact same conditions
 * ProjectDetails.js uses.
 *
 * Usage: node scripts/readOnlyAuditOneOrderAddonGate.js <orderId>
 */
require("dotenv").config();
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
require("../models/productModel"); // registers 'product' for the populate below
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const orderId = process.argv[2];

(async () => {
  if (!orderId) {
    console.error("Pass an orderId");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const order = await orderModel
    .findById(orderId)
    .populate("productId", "serviceName category")
    .lean();

  if (!order) {
    console.log("Order not found");
    await mongoose.disconnect();
    return;
  }

  console.log(`\n=== ORDER ${orderId} ===`);
  console.log(`  product        : ${order.productId?.serviceName} (${order.productId?.category})`);
  console.log(`  orderVisibility: ${order.orderVisibility}`);
  console.log(`  status         : ${order.status}`);
  console.log(`  projectProgress: ${order.projectProgress}`);
  console.log(`  currentPhase   : ${order.currentPhase}`);
  console.log(`  isWebsiteProject: ${order.isWebsiteProject}`);
  console.log(`  isPartialPayment: ${order.isPartialPayment}`);
  console.log(`  paymentComplete : ${order.paymentComplete}`);

  // getOrderDetails.js derives hasUnpaidInvoice from invoiceModel.
  const invoices = await invoiceModel
    .find({ orderId: order._id })
    .select("invoiceNumber amount amountPaid status installmentNumber")
    .lean();

  console.log(`\n=== INVOICES (${invoices.length}) ===`);
  invoices.forEach((inv) => {
    console.log(
      `  ${inv.invoiceNumber} | status=${inv.status} | amount=${inv.amount} | paid=${inv.amountPaid ?? 0}` +
        (inv.installmentNumber ? ` | installment #${inv.installmentNumber}` : "")
    );
  });

  const unpaidInvoice = invoices.find((i) => i.status !== "paid" && i.status !== "cancelled");

  const pendingTxn = await transactionModel
    .find({ orderId: order._id, status: "pending" })
    .select("transactionId amount status paymentMethod")
    .lean();

  console.log(`\n=== PENDING TRANSACTIONS (${pendingTxn.length}) ===`);
  pendingTxn.forEach((t) => console.log(`  ${t.transactionId} | ${t.paymentMethod} | ${t.amount}`));

  // ---- The gate ProjectDetails.js actually uses (canAddService). A service is
  // a separate full-payment purchase, so the project's own invoice state is
  // deliberately NOT part of this test. ----
  const canAddService =
    order.orderVisibility !== "pending-approval" &&
    order.orderVisibility !== "payment-rejected";

  console.log(`\n=== ADD-A-SERVICE CARD GATE ===`);
  console.log(`  orderVisibility        : ${order.orderVisibility}`);
  console.log(`  not pending-approval   : ${order.orderVisibility !== "pending-approval"}`);
  console.log(`  not payment-rejected   : ${order.orderVisibility !== "payment-rejected"}`);
  console.log(
    `  (unpaid invoice present: ${Boolean(unpaidInvoice)} — intentionally NOT a blocker)`
  );

  console.log(`\n  => CARD RENDERS: ${canAddService ? "YES" : "NO"}`);
  if (!canAddService) {
    console.log(`\n  Blocked because the project is '${order.orderVisibility}' — not a confirmed sale yet.`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Audit failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
