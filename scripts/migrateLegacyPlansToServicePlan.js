// Migration: legacy plan orders -> Service Plan order fields.
// SAFE BY DEFAULT: runs in dry-run mode unless --apply is passed.
// Dry-run only reads from the DB and prints what WOULD change — no writes.
// --apply performs the actual update, and only after a --backup file has
// been written in the same run (see writeBackup below).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const productModel = require("../models/productModel");
require("../models/userModel");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

// Maps one legacy product's fields to a servicePlanSnapshot object.
// This mirrors createGenericPlan.js's field shape exactly (see
// backend/controller/product/createServicePlan.js) — no new shape invented.
const buildSnapshotFromLegacyProduct = (product) => {
  if (product.isMonthlyLimitedPlan) {
    return {
      planType: "website_updates",
      limitScope: "per_month",
      portalAccessCount: product.monthlyUpdateLimit || null,
      filesLimit: 20, // matches today's hardcoded global file-upload cap
      validityUnit: "year",
      validityValue: Math.round((product.yearlyPlanDuration || 365) / 365),
      validityInDays: product.yearlyPlanDuration || 365,
      billingCycle: "monthly",
    };
  }

  if (product.isMonthlyRenewablePlan) {
    return {
      planType: "website_updates",
      limitScope: "unlimited",
      portalAccessCount: null,
      filesLimit: 20,
      validityUnit: "year",
      validityValue: Math.round((product.yearlyPlanDuration || 365) / 365),
      validityInDays: product.yearlyPlanDuration || 365,
      billingCycle: "monthly",
    };
  }

  // Simple/one-time plan
  return {
    planType: "website_updates",
    limitScope: "per_plan",
    portalAccessCount: product.updateCount || 1,
    filesLimit: 20,
    validityUnit: "day",
    validityValue: product.validityPeriod || 1,
    validityInDays: product.validityPeriod || 1,
    billingCycle: undefined,
  };
};

const resolveServicePlanStatus = (order, endDate) => {
  if (endDate && endDate.getTime() < Date.now()) return "expired";
  if (order.isActive === false) return "paused";
  return "active";
};

const buildOrderUpdate = (order, product) => {
  const snapshot = buildSnapshotFromLegacyProduct(product);
  const startDate = new Date(order.createdAt);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + (snapshot.validityInDays || 0));

  return {
    isServicePlan: true,
    servicePlanSnapshot: snapshot,
    servicePlanStartDate: startDate,
    servicePlanEndDate: endDate,
    serviceCurrentCycleNumber: 1,
    serviceCurrentCycleStart: startDate,
    serviceCurrentCycleEnd: endDate,
    serviceAccessUsedInCycle: order.currentMonthUpdatesUsed || 0,
    serviceAccessUsedTotal: order.updatesUsed || 0,
    servicePlanStatus: resolveServicePlanStatus(order, endDate),
  };
};

const writeBackup = (records) => {
  const backupDir = path.join(__dirname, "..", "migration-backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const filePath = path.join(
    backupDir,
    `legacy-plan-orders-before-migration-${Date.now()}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  return filePath;
};

const run = async () => {
  const shouldApply = hasFlag("apply");

  await mongoose.connect(process.env.MONGODB_URI);

  const legacyProducts = await productModel
    .find({
      $or: [
        { isWebsiteUpdate: true },
        { isMonthlyRenewablePlan: true },
        { isMonthlyLimitedPlan: true },
      ],
    })
    .lean();

  const productById = new Map(legacyProducts.map((p) => [p._id.toString(), p]));

  const legacyOrders = await orderProductModel
    .find({ productId: { $in: legacyProducts.map((p) => p._id) } })
    .populate("userId", "name email")
    .lean();

  console.log(`\nMode: ${shouldApply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Found ${legacyOrders.length} legacy plan order(s) to migrate.\n`);

  const preview = legacyOrders.map((order) => {
    const product = productById.get(order.productId.toString());
    const update = buildOrderUpdate(order, product);
    return {
      orderId: order._id.toString(),
      customerEmail: order.userId?.email,
      productName: product?.serviceName,
      before: {
        isActive: order.isActive,
        updatesUsed: order.updatesUsed,
        currentMonthUpdatesUsed: order.currentMonthUpdatesUsed,
        currentMonthUpdatesLimit: order.currentMonthUpdatesLimit,
        autoRenewalStatus: order.autoRenewalStatus,
      },
      after: update,
    };
  });

  preview.forEach((item) => {
    console.log("----------------------------------------------------");
    console.log(`Order: ${item.orderId} | Customer: ${item.customerEmail} | Product: ${item.productName}`);
    console.log("BEFORE (legacy fields, unchanged, still present):", JSON.stringify(item.before, null, 2));
    console.log("AFTER (new additive fields to be set):", JSON.stringify(item.after, null, 2));
  });

  if (!shouldApply) {
    console.log("\nDry run complete. No changes written. Re-run with --apply to write these changes.");
    await mongoose.disconnect();
    return;
  }

  const backupPath = writeBackup(legacyOrders);
  console.log(`\nBackup written before applying changes: ${backupPath}`);

  for (const item of preview) {
    await orderProductModel.updateOne(
      { _id: item.orderId },
      { $set: item.after }
    );
  }

  console.log(`\nApplied. ${preview.length} order(s) updated with additive Service Plan fields.`);
  console.log("Legacy fields (isActive, updatesUsed, autoRenewalStatus, etc.) were NOT removed or modified.");

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
