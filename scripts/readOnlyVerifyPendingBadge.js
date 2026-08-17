/**
 * READ-ONLY — no writes. Verifies the pending-payment badge fix by evaluating BOTH the
 * old and the new banner logic against every real website-project order, so the change
 * can be checked against live data instead of reasoning.
 *
 * OLD banner gate : order.orderVisibility === 'pending-approval'  -> "Payment Submitted"
 * NEW banner gate : a pending payment transaction exists          -> "Payment Submitted"
 *
 * Usage: node scripts/readOnlyVerifyPendingBadge.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
require("../models/productModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const money = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;

const bannerFor = ({ hasPendingPayment, hasUnpaidInvoice }) =>
  hasPendingPayment ? "PAYMENT SUBMITTED" : hasUnpaidInvoice ? "PAYMENT PENDING" : "none";

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const orders = await orderModel
    .find({ isWebsiteProject: true })
    .populate("productId", "serviceName")
    .sort({ createdAt: -1 })
    .limit(25)
    .lean();

  console.log(`\nChecking ${orders.length} website project order(s), newest first.\n`);

  let changed = 0;

  for (const order of orders) {
    // Exactly what getOrderDetails.js derives.
    const unpaidInvoice = await invoiceModel
      .findOne({ orderId: order._id, status: { $in: ["unpaid", "overdue"] } })
      .sort({ installmentNumber: 1, invoiceDate: 1 })
      .select("invoiceNumber invoiceType status amount")
      .lean();

    const pendingTxn = await transactionModel
      .findOne({ orderId: order._id, status: "pending", type: "payment" })
      .sort({ createdAt: -1 })
      .select("transactionId amount paymentMethod installmentNumber")
      .lean();

    const hasUnpaidInvoice = Boolean(unpaidInvoice);
    const hasPendingPayment = Boolean(pendingTxn);
    const isOrderPendingApproval = order.orderVisibility === "pending-approval";

    const oldBanner = bannerFor({
      hasPendingPayment: isOrderPendingApproval, // OLD gate used orderVisibility
      hasUnpaidInvoice,
    });
    const newBanner = bannerFor({ hasPendingPayment, hasUnpaidInvoice });

    const differs = oldBanner !== newBanner;
    if (differs) changed += 1;

    console.log(
      `${differs ? "CHANGED " : "same    "} ${order._id} | ${(order.productId?.serviceName || "-").padEnd(18)}` +
        ` | vis=${String(order.orderVisibility).padEnd(16)} paid=${money(order.paidAmount).padEnd(12)}`
    );
    console.log(
      `          unpaidInvoice=${hasUnpaidInvoice ? unpaidInvoice.invoiceNumber + "(" + unpaidInvoice.invoiceType + ")" : "none"}` +
        ` | pendingTxn=${hasPendingPayment ? pendingTxn.transactionId + " " + money(pendingTxn.amount) : "none"}`
    );
    if (differs) {
      console.log(`          OLD -> ${oldBanner}`);
      console.log(`          NEW -> ${newBanner}`);
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Banner changes: ${changed} of ${orders.length} order(s).`);
  console.log("READ-ONLY. Nothing was written.");
  console.log("=".repeat(72));

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Verify failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
