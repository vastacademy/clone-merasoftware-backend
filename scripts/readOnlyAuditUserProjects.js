/**
 * READ-ONLY — no writes. Lists every website project of one user (by email) with the
 * money/approval facts that decide what the customer sees, so the stuck one can be
 * identified without guessing.
 *
 * Usage: node scripts/readOnlyAuditUserProjects.js <email>
 */
require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const orderModel = require("../models/orderProductModel");
require("../models/productModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const email = process.argv[2];
const money = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;

(async () => {
  if (!email) {
    console.error("Pass an email");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const user = await userModel.findOne({ email }).select("name email walletBalance").lean();
  if (!user) {
    console.log(`No user with email ${email}`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\nUSER: ${user.name} <${user.email}>`);
  console.log(`  _id          : ${user._id}`);
  console.log(`  walletBalance: ${money(user.walletBalance)}`);

  const orders = await orderModel
    .find({ userId: user._id })
    .populate("productId", "serviceName category")
    .sort({ createdAt: -1 })
    .lean();

  console.log(`\nORDERS (${orders.length}) — newest first`);

  for (const order of orders) {
    const invoices = await invoiceModel
      .find({ orderId: order._id })
      .select("invoiceNumber invoiceType amount amountPaid status installmentNumber")
      .sort({ invoiceDate: 1 })
      .lean();

    const txns = await transactionModel
      .find({ orderId: order._id })
      .select("transactionId amount status paymentMethod sourceType invoiceId installmentNumber upiTransactionId createdAt")
      .sort({ createdAt: 1 })
      .lean();

    // The badge query, verbatim from getOrderDetails.js:91
    const badgeInvoice = await invoiceModel
      .findOne({ orderId: order._id, status: { $in: ["unpaid", "overdue"] } })
      .sort({ installmentNumber: 1, invoiceDate: 1 })
      .select("invoiceNumber invoiceType status amount")
      .lean();

    const completed = txns.filter((t) => t.status === "completed");
    const pending = txns.filter((t) => t.status === "pending");
    const totalCompleted = completed.reduce((s, t) => s + Number(t.amount || 0), 0);

    console.log(`\n${"-".repeat(76)}`);
    console.log(`ORDER ${order._id}`);
    console.log(`  ${order.productId?.serviceName || "-"}  |  created ${order.createdAt}`);
    console.log(`  isWebsiteProject=${order.isWebsiteProject} isPartialPayment=${order.isPartialPayment}`);
    console.log(`  orderVisibility=${order.orderVisibility}  status=${order.status}`);
    console.log(`  total=${money(order.totalAmount)} paid=${money(order.paidAmount)} remaining=${money(order.remainingAmount)} complete=${order.paymentComplete}`);

    if (Array.isArray(order.installments) && order.installments.length) {
      order.installments.forEach((i) =>
        console.log(`     inst#${i.installmentNumber} ${money(i.amount)} paid=${i.paid} paymentStatus=${i.paymentStatus}`)
      );
    }

    console.log(`  invoices (${invoices.length}):`);
    invoices.forEach((inv) =>
      console.log(
        `     ${inv.invoiceNumber} type=${inv.invoiceType} status=${inv.status} amount=${money(inv.amount)} amountPaid=${money(inv.amountPaid)}` +
          (inv.installmentNumber ? ` inst#${inv.installmentNumber}` : "")
      )
    );

    console.log(`  transactions (${txns.length}) completed=${completed.length} pending=${pending.length} totalCompleted=${money(totalCompleted)}:`);
    txns.forEach((t) => {
      const target = t.invoiceId ? invoices.find((i) => String(i._id) === String(t.invoiceId)) : null;
      console.log(
        `     ${t.transactionId} ${t.paymentMethod} ${money(t.amount)} status=${t.status} sourceType=${t.sourceType || "-"}` +
          (t.installmentNumber ? ` inst#${t.installmentNumber}` : "") +
          ` invoiceId=${t.invoiceId ? (target ? `${target.invoiceNumber}(${target.invoiceType})` : String(t.invoiceId)) : "NULL"}`
      );
    });

    console.log(`  BADGE QUERY -> hasUnpaidInvoice=${Boolean(badgeInvoice)}` +
      (badgeInvoice ? ` picked=${badgeInvoice.invoiceNumber}(${badgeInvoice.invoiceType}, ${badgeInvoice.status})` : ""));

    // Flag the reported symptom: real money is in, but the order never became approved.
    if (totalCompleted > 0 && order.orderVisibility === "pending-approval") {
      console.log(`  *** STUCK: ${money(totalCompleted)} completed payment but still 'pending-approval' ***`);
    }
    if (totalCompleted > 0 && badgeInvoice) {
      console.log(`  *** BADGE STILL ON: money received but ${badgeInvoice.invoiceNumber} is ${badgeInvoice.status} ***`);
    }
  }

  console.log(`\n${"=".repeat(76)}`);
  console.log("READ-ONLY audit complete. Nothing was written.");

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Audit failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
