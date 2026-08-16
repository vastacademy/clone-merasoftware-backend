/**
 * READ-ONLY audit — no writes of any kind.
 *
 * Answers one question: can a customer actually add a service to an existing
 * project right now? Checks the catalog side (are there buyable service plans,
 * and is their config complete enough for the purchase controller to accept
 * them) and the project side (do customers have projects the card would show on).
 */
require("dotenv").config();
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const plans = await productModel
    .find({ category: "service_plan", isServicePlan: true })
    .select("serviceName isHidden price sellingPrice servicePlan")
    .lean();

  console.log(`\n=== SERVICE PLANS IN CATALOG: ${plans.length} ===`);

  let buyable = 0;
  plans.forEach((plan) => {
    const sp = plan.servicePlan || {};
    const price = plan.sellingPrice ?? plan.price;
    const validityInDays =
      Number(sp.validityInDays) ||
      Number(sp.validityValue || 0) * (VALIDITY_UNIT_DAYS[sp.validityUnit] || 0);

    // Exactly the conditions customerCreateServicePlanOrder.js enforces.
    const blockers = [];
    if (plan.isHidden) blockers.push("hidden from customers");
    if (!(Number(price) > 0)) blockers.push("no price");
    if (!(validityInDays > 0)) blockers.push("no valid duration");

    if (blockers.length === 0) buyable += 1;

    console.log(
      `  ${blockers.length === 0 ? "BUYABLE " : "BLOCKED "} ${plan.serviceName}` +
        ` | behavior=${sp.serviceBehavior || "(not set)"}` +
        ` | billing=${sp.billingCycle || "(none)"}` +
        ` | validityDays=${validityInDays || 0}` +
        ` | price=${price ?? "(none)"}` +
        (blockers.length ? `\n            blockers: ${blockers.join(", ")}` : "")
    );
  });

  console.log(`\n  Buyable right now: ${buyable} of ${plans.length}`);

  // Project side — the Add-a-Service card renders on an approved project whose
  // own invoice is settled, so count what customers actually have.
  const projectOrders = await orderModel
    .find({ isWebsiteProject: true })
    .select("orderVisibility projectProgress currentPhase userId")
    .lean();

  // canAddService: any confirmed sale — only pending-approval and
  // payment-rejected are excluded. The project's own invoice state is not a
  // blocker, since a service is a separate full-payment purchase.
  const eligible = projectOrders.filter(
    (o) =>
      o.orderVisibility !== "pending-approval" && o.orderVisibility !== "payment-rejected"
  );
  const finished = eligible.filter(
    (o) => o.projectProgress >= 100 || o.currentPhase === "completed"
  );

  console.log(`\n=== CUSTOMER PROJECTS ===`);
  console.log(`  Total project orders    : ${projectOrders.length}`);
  console.log(`  Card shows on           : ${eligible.length}`);
  console.log(`    of which completed    : ${finished.length}  -> "Ongoing servicing"`);
  console.log(`    of which in progress  : ${eligible.length - finished.length}  -> "Add a service"`);
  console.log(`  Excluded (not a confirmed sale): ${projectOrders.length - eligible.length}`);

  const existingAddons = await orderModel.countDocuments({ linkedProjectOrderId: { $ne: null } });
  console.log(`\n=== EXISTING ADD-ONS: ${existingAddons} ===`);

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Audit failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
