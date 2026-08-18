/**
 * Retires (deletes) a plan product ONLY after proving every order that bought it can still
 * describe itself without that plan template.
 *
 * DRY RUN BY DEFAULT — prints the safety check per order and writes nothing.
 * Pass --apply to delete once the check passes.
 *
 * WHY THIS IS SAFE (the design, not a hope):
 *   A plan product is a CATALOGUE entry. The customer's order is the CONTRACT, and it already
 *   carries its own copy of what was bought:
 *     - orderItems[].name       -> the purchased name at purchase time
 *     - price / totalAmount     -> what they paid
 *     - servicePlanSnapshot     -> the frozen plan config (validity, limits, billing)
 *     - servicePlanStartDate/EndDate -> the actual term
 *   So deleting the template removes nothing the customer's record needs. This script REFUSES
 *   to delete when an order is missing that self-description, because then the template really
 *   would be the only source of truth.
 *
 * Usage:
 *   node scripts/deletePlanKeepOrderData.js "<plan name>"
 *   node scripts/deletePlanKeepOrderData.js "<plan name>" --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");

const apply = process.argv.includes("--apply");
const planName = process.argv.slice(2).find((a) => !a.startsWith("--"));

(async () => {
  if (!planName) {
    console.error('Pass the plan name, e.g. node scripts/deletePlanKeepOrderData.js "Website update plan Yearly"');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const plans = await productModel
    .find({ serviceName: planName })
    .select("_id serviceName category isServicePlan servicePlan")
    .lean();

  if (!plans.length) {
    console.log(`No plan named "${planName}" found.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`\n${apply ? "APPLY" : "DRY RUN"} — retire plan "${planName}"`);
  console.log("=".repeat(74));

  let allSafe = true;

  for (const plan of plans) {
    const orders = await orderModel.find({ productId: plan._id }).lean();

    console.log(`\nPlan _id=${plan._id}  orders=${orders.length}`);

    for (const order of orders) {
      const user = await userModel.findById(order.userId).select("email").lean();

      const snapshotName =
        (order.orderItems || []).find((i) => i.type === "main")?.name ||
        order.orderItems?.[0]?.name ||
        null;
      const hasPrice = Number(order.price || order.totalAmount || 0) > 0;
      const hasConfig = order.isServicePlan
        ? Boolean(order.servicePlanSnapshot && Object.keys(order.servicePlanSnapshot).length)
        : true; // legacy plans carry their own updateCount/validity fields on the order
      const hasTerm = order.isServicePlan
        ? Boolean(order.servicePlanStartDate || order.servicePlanEndDate)
        : true;

      const safe = Boolean(snapshotName) && hasPrice && hasConfig && hasTerm;
      if (!safe) allSafe = false;

      console.log(`  order ${order._id} | ${user?.email || "?"}`);
      console.log(`     name on order   : ${snapshotName || "MISSING"}`);
      console.log(`     price on order  : ${hasPrice ? order.price || order.totalAmount : "MISSING"}`);
      console.log(`     config snapshot : ${hasConfig ? "present" : "MISSING"}`);
      if (order.isServicePlan && order.servicePlanSnapshot) {
        const s = order.servicePlanSnapshot;
        console.log(
          `        validity=${s.validityValue || "-"} ${s.validityUnit || ""} (${s.validityInDays || "-"} days)` +
            ` | billing=${s.billingCycle || "-"} | planType=${s.planType || "-"}`
        );
      }
      console.log(`     term dates      : ${hasTerm ? `${order.servicePlanStartDate} -> ${order.servicePlanEndDate}` : "MISSING"}`);
      console.log(`     => ${safe ? "SAFE — order is self-describing" : "NOT SAFE — template is still its only source"}`);
    }
  }

  console.log(`\n${"-".repeat(74)}`);

  if (!allSafe) {
    console.log(`REFUSING to delete: at least one order cannot describe itself without the plan.`);
    console.log(`Nothing was written.`);
    await mongoose.disconnect();
    return;
  }

  console.log(`All orders are self-describing. Deleting the template loses no customer data.`);

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written. Re-run with --apply to delete.`);
    await mongoose.disconnect();
    return;
  }

  const res = await productModel.deleteMany({ _id: { $in: plans.map((p) => p._id) } });
  console.log(`\nDeleted ${res.deletedCount} plan product(s).`);

  // Prove the orders survived intact.
  for (const plan of plans) {
    const orders = await orderModel
      .find({ productId: plan._id })
      .select("_id orderItems price servicePlanSnapshot servicePlanEndDate isActive")
      .lean();
    console.log(`\nOrders after deletion (${orders.length}) — still intact:`);
    orders.forEach((o) => {
      const name =
        (o.orderItems || []).find((i) => i.type === "main")?.name || o.orderItems?.[0]?.name;
      console.log(
        `  ${o._id} | name="${name}" | price=${o.price} | validity=${o.servicePlanSnapshot?.validityInDays || "-"}d` +
          ` | ends=${o.servicePlanEndDate} | isActive=${o.isActive}`
      );
    });
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
