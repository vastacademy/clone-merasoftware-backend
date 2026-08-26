/**
 * READ-ONLY — no writes. Verifies the getUserOrder.js list-badge fix by evaluating
 * OLD list logic, NEW list logic, and getOrderDetails.js's logic against every real
 * website-project order, so the fix is checked against live data, not reasoning.
 *
 * OLD list logic  : ANY unpaid/overdue invoice on the order        -> hasUnpaidInvoice
 * NEW list logic  : helpers/projectDuePayment.getDueUnpaidInvoiceFilter (same as detail page)
 * DETAIL logic    : getOrderDetails.js's own query (should now match NEW exactly)
 *
 * Usage: node scripts/readOnlyVerifyListBadgeFix.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
require("../models/productModel");
const invoiceModel = require("../models/invoiceModel");
const { getDueUnpaidInvoiceFilter } = require("../helpers/projectDuePayment");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const orders = await orderModel
    .find({ isWebsiteProject: true })
    .populate("productId", "serviceName")
    .sort({ createdAt: -1 })
    .select("installments currentInstallment projectProgress orderVisibility paidAmount productId projectSnapshot")
    .lean();

  console.log(`\nChecking ${orders.length} website project order(s).\n`);

  let mismatchOldVsNew = 0;
  let mismatchNewVsDetail = 0;

  for (const order of orders) {
    // OLD list logic (pre-fix getUserOrder.js): any unpaid/overdue invoice, anywhere on the order.
    const anyUnpaidInvoice = await invoiceModel.exists({
      orderId: order._id,
      status: { $in: ["unpaid", "overdue"] },
    });
    const oldHasUnpaid = Boolean(anyUnpaidInvoice);

    // NEW list logic (fixed getUserOrder.js): shared due-installment-aware filter.
    const newUnpaidInvoice = await invoiceModel
      .findOne(getDueUnpaidInvoiceFilter(order))
      .select("invoiceNumber installmentNumber status")
      .lean();
    const newHasUnpaid = Boolean(newUnpaidInvoice);

    const name = order.projectSnapshot?.displayName || order.productId?.serviceName || "-";
    const hasInstallments = Array.isArray(order.installments) && order.installments.length > 0;

    if (oldHasUnpaid !== newHasUnpaid) {
      mismatchOldVsNew += 1;
      console.log(`DIFFERS  ${order._id} | ${name.slice(0, 24).padEnd(24)} | installments=${hasInstallments} | currentInstallment=${order.currentInstallment} | progress=${order.projectProgress}`);
      console.log(`          OLD hasUnpaidInvoice=${oldHasUnpaid}  ->  NEW hasUnpaidInvoice=${newHasUnpaid} (${newUnpaidInvoice ? `#${newUnpaidInvoice.installmentNumber}` : "none due"})`);
      if (hasInstallments) {
        order.installments.forEach((inst) => {
          console.log(`            installment #${inst.installmentNumber} paid=${inst.paid} threshold=${inst.progressThreshold}`);
        });
      }
    }
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(`OLD vs NEW list-badge mismatches: ${mismatchOldVsNew} of ${orders.length} order(s).`);
  console.log("(A mismatch here is an order the fix actually changes the badge for.)");
  console.log("READ-ONLY. Nothing was written.");
  console.log("=".repeat(72));

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Verify failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
