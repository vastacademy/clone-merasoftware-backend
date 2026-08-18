/**
 * Deletes named plan products ONLY IF nothing depends on them.
 *
 * DRY RUN BY DEFAULT — prints the decision for each plan and writes nothing.
 * Pass --apply to delete the ones that qualify.
 *
 * The rule (user-stated, enforced here rather than left to the operator):
 *   A plan is deleted only when it has ZERO orders. If any customer ever bought it —
 *   active or not — the plan is KEPT, because deleting it would leave that order
 *   pointing at a product that no longer exists.
 *
 * Usage:
 *   node scripts/deleteUnusedPlans.js                 # dry run
 *   node scripts/deleteUnusedPlans.js --apply         # delete the unused ones
 */
require("dotenv").config();
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");

const apply = process.argv.includes("--apply");

// The plans the user asked to remove, by exact name.
const TARGET_PLAN_NAMES = ["Academy mission", "Website update plan Yearly"];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  console.log(`\n${apply ? "APPLY" : "DRY RUN"}`);
  console.log("=".repeat(72));

  const deletable = [];
  const kept = [];

  for (const name of TARGET_PLAN_NAMES) {
    const plans = await productModel
      .find({ serviceName: name })
      .select("_id serviceName isServicePlan servicePlan")
      .lean();

    if (!plans.length) {
      console.log(`\n"${name}" — not found (already gone?)`);
      continue;
    }

    for (const plan of plans) {
      const orders = await orderModel
        .find({ productId: plan._id })
        .select("_id userId isActive orderVisibility paidAmount")
        .lean();

      console.log(`\n"${plan.serviceName}"  (_id=${plan._id})`);
      console.log(`   planType : ${plan.servicePlan?.planType || "-"}`);
      console.log(`   orders   : ${orders.length}`);

      for (const order of orders) {
        const user = await userModel.findById(order.userId).select("email").lean();
        console.log(
          `      ${order._id} | ${user?.email || "?"} | isActive=${order.isActive}` +
            ` | ${order.orderVisibility} | paid=${order.paidAmount}`
        );
      }

      if (orders.length === 0) {
        console.log(`   => DELETE (nothing depends on it)`);
        deletable.push(plan);
      } else {
        console.log(`   => KEEP — ${orders.length} customer order(s) depend on it`);
        kept.push({ plan, orderCount: orders.length });
      }
    }
  }

  console.log(`\n${"-".repeat(72)}`);
  console.log(`Will delete : ${deletable.length}`);
  deletable.forEach((p) => console.log(`   ${p.serviceName}`));
  console.log(`Will keep   : ${kept.length}`);
  kept.forEach((k) => console.log(`   ${k.plan.serviceName} (${k.orderCount} order(s))`));

  if (!apply) {
    console.log(`\nDRY RUN — nothing was written. Run with --apply to delete.`);
    await mongoose.disconnect();
    return;
  }

  if (!deletable.length) {
    console.log(`\nNothing qualifies for deletion. No writes made.`);
    await mongoose.disconnect();
    return;
  }

  const res = await productModel.deleteMany({ _id: { $in: deletable.map((p) => p._id) } });
  console.log(`\nDeleted ${res.deletedCount} plan product(s).`);

  // Verify: every kept plan must still exist, every deleted one must be gone.
  for (const k of kept) {
    const still = await productModel.exists({ _id: k.plan._id });
    console.log(`   kept "${k.plan.serviceName}" still present: ${Boolean(still)}`);
  }
  for (const p of deletable) {
    const gone = !(await productModel.exists({ _id: p._id }));
    console.log(`   deleted "${p.serviceName}" removed: ${gone}`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
