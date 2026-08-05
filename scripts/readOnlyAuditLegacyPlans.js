// READ-ONLY audit script. Does not write/update/delete anything.
// Purpose: find every live customer currently on a legacy plan (isWebsiteUpdate /
// isMonthlyRenewablePlan / isMonthlyLimitedPlan), so a future migration script can
// be designed against real field values instead of assumptions.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const productModel = require("../models/productModel");
const userModel = require("../models/userModel");

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const legacyProducts = await productModel
    .find({
      $or: [
        { isWebsiteUpdate: true },
        { isMonthlyRenewablePlan: true },
        { isMonthlyLimitedPlan: true },
      ],
    })
    .select(
      "_id serviceName category isWebsiteUpdate isMonthlyRenewablePlan isMonthlyLimitedPlan isUnlimitedUpdates validityPeriod updateCount yearlyPlanDuration monthlyUpdateLimit monthlyRenewalPrice monthlyRenewalCost isHidden"
    )
    .lean();

  console.log(`\n=== Legacy plan PRODUCTS found: ${legacyProducts.length} ===`);
  legacyProducts.forEach((p) => {
    console.log(JSON.stringify(p, null, 2));
  });

  const legacyProductIds = legacyProducts.map((p) => p._id);

  const legacyOrders = await orderProductModel
    .find({ productId: { $in: legacyProductIds } })
    .select(
      "_id userId productId orderVisibility status isActive updatesUsed currentMonthUpdatesUsed currentMonthUpdatesLimit monthlyLimitResetDate totalYearlyDaysRemaining autoRenewalStatus currentMonthExpiryDate createdAt"
    )
    .populate("userId", "name email")
    .populate("productId", "serviceName category")
    .lean();

  console.log(`\n=== Legacy plan ORDERS found: ${legacyOrders.length} ===`);
  legacyOrders.forEach((o) => {
    console.log(JSON.stringify(o, null, 2));
  });

  const uniqueCustomerIds = new Set(
    legacyOrders.map((o) => (o.userId?._id || o.userId || "").toString())
  );
  console.log(`\n=== Unique customers with a legacy plan order: ${uniqueCustomerIds.size} ===`);
  console.log([...uniqueCustomerIds]);

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exit(1);
  });
