/**
 * Deletes the OLD-SYSTEM plan products (and optionally their orders).
 *
 * DRY RUN BY DEFAULT — prints exactly what would be deleted and writes nothing.
 * Pass --apply to actually delete. Pass --with-orders to also delete the customer
 * orders that reference these plans.
 *
 * WHAT COUNTS AS "OLD SYSTEM" (this is the whole safety story):
 *   A legacy plan is a product flagged isWebsiteUpdate / isMonthlyRenewablePlan /
 *   isMonthlyLimitedPlan — the pre-Service-Plan shape (see DOCS/27).
 *   A product with isServicePlan: true is the NEW system and is NEVER selected,
 *   even if it somehow also carries a legacy flag (explicitly excluded below).
 *
 * Usage:
 *   node scripts/deleteLegacyPlans.js                          # dry run (default)
 *   node scripts/deleteLegacyPlans.js --apply                  # delete products only
 *   node scripts/deleteLegacyPlans.js --apply --with-orders     # delete products + their orders
 */
require("dotenv").config();
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");

const apply = process.argv.includes("--apply");
const withOrders = process.argv.includes("--with-orders");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // Old-system plans only. isServicePlan is the new system — hard-excluded, never touched.
  const legacyPlans = await productModel
    .find({
      isServicePlan: { $ne: true },
      $or: [
        { isWebsiteUpdate: true },
        { isMonthlyRenewablePlan: true },
        { isMonthlyLimitedPlan: true },
      ],
    })
    .select("_id serviceName category isWebsiteUpdate isMonthlyRenewablePlan isMonthlyLimitedPlan")
    .lean();

  // Safety net: prove no new-system plan is in the selection.
  const contaminated = await productModel.countDocuments({
    _id: { $in: legacyPlans.map((p) => p._id) },
    isServicePlan: true,
  });
  if (contaminated > 0) {
    console.error(`ABORT: ${contaminated} Service Plan(s) matched the legacy filter. Nothing deleted.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\n${apply ? "APPLY" : "DRY RUN"}${withOrders ? " + ORDERS" : ""}`);
  console.log(`${"=".repeat(72)}`);
  console.log(`\nLEGACY PLANS TO DELETE (${legacyPlans.length}):\n`);

  let totalOrders = 0;
  const orderIdsToDelete = [];

  for (const plan of legacyPlans) {
    const orders = await orderModel
      .find({ productId: plan._id })
      .select("_id userId isActive orderVisibility createdAt")
      .populate("userId", "name email")
      .lean();

    totalOrders += orders.length;
    orders.forEach((o) => orderIdsToDelete.push(o._id));

    console.log(`  ${plan.serviceName}`);
    console.log(`     _id=${plan._id}  category=${plan.category}`);
    console.log(`     linked orders: ${orders.length}`);
    orders.forEach((o) => {
      console.log(
        `        order ${o._id} | ${o.userId?.email || "?"} | isActive=${o.isActive} | ${o.orderVisibility}`
      );
    });
  }

  // Show what is being preserved, so the blast radius is explicit.
  const servicePlans = await productModel
    .find({ isServicePlan: true })
    .select("serviceName")
    .lean();
  console.log(`\nPRESERVED — new-system Service Plans (${servicePlans.length}), never touched:`);
  servicePlans.forEach((p) => console.log(`  ${p.serviceName}`));

  console.log(`\n${"-".repeat(72)}`);
  console.log(`Plans to delete : ${legacyPlans.length}`);
  console.log(`Orders affected : ${totalOrders}`);
  console.log(
    `Orders will be  : ${
      withOrders
        ? "DELETED (--with-orders)"
        : "KEPT — their productId will point at a deleted product (dangling)"
    }`
  );

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written.`);
    console.log(`Run with --apply to delete${withOrders ? " (including orders)" : ""}.`);
    await mongoose.disconnect();
    return;
  }

  // ---- Writes start here, only with --apply ----
  if (withOrders && orderIdsToDelete.length) {
    const res = await orderModel.deleteMany({ _id: { $in: orderIdsToDelete } });
    console.log(`\nDeleted ${res.deletedCount} order(s).`);
  }

  const planRes = await productModel.deleteMany({ _id: { $in: legacyPlans.map((p) => p._id) } });
  console.log(`Deleted ${planRes.deletedCount} legacy plan product(s).`);

  const remaining = await productModel.countDocuments({
    isServicePlan: { $ne: true },
    $or: [
      { isWebsiteUpdate: true },
      { isMonthlyRenewablePlan: true },
      { isMonthlyLimitedPlan: true },
    ],
  });
  const serviceStillThere = await productModel.countDocuments({ isServicePlan: true });
  console.log(`\nVerification: legacy plans remaining = ${remaining}, Service Plans intact = ${serviceStillThere}`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
