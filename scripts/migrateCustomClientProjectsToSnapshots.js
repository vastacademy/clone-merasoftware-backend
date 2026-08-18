// Migration: legacy hidden custom-project products -> frozen order.projectSnapshot.
//
// SAFE BY DEFAULT: without --apply this is a read-only audit/dry run. It never
// writes or deletes. With --apply it only adds projectSnapshot to eligible
// orders after writing a JSON backup; it deliberately does NOT delete or alter
// the legacy product records. Product cleanup is a separate, later decision.
//
// Eligibility is intentionally strict:
// - product is explicitly marked isCustomClientProject
// - linked order is a website project and has no snapshot already
// - the legacy product contains a complete, internally consistent commercial
//   scope from which every snapshot field can be reproduced exactly
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const productModel = require("../models/productModel");

const PROJECT_CATEGORIES = new Set([
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
]);

const shouldApply = process.argv.includes("--apply");
const asFiniteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const orderFinalPrice = (order) =>
  asFiniteNumber(order.totalAmount ?? order.price ?? order.originalPrice);

const buildSnapshot = ({ order, product }) => {
  const referenceTotal = asFiniteNumber(product.price);
  const finalPrice = orderFinalPrice(order);
  const features = Array.isArray(product.clientProjectFeatures)
    ? product.clientProjectFeatures.map((feature) => ({
        featureId: feature.featureId,
        name: String(feature.name || "").trim(),
        price: asFiniteNumber(feature.price),
      }))
    : [];

  const missingFields = [];
  if (!String(product.serviceName || "").trim()) missingFields.push("product.serviceName");
  if (!PROJECT_CATEGORIES.has(product.category)) missingFields.push("product.category");
  if (referenceTotal === null || referenceTotal < 0) missingFields.push("product.price");
  if (finalPrice === null || finalPrice < 0) missingFields.push("order total");
  features.forEach((feature, index) => {
    if (!feature.featureId) missingFields.push(`feature[${index}].featureId`);
    if (!feature.name) missingFields.push(`feature[${index}].name`);
    if (feature.price === null || feature.price < 0) missingFields.push(`feature[${index}].price`);
  });
  if (missingFields.length) return { eligible: false, reason: missingFields.join(", ") };

  const featuresTotal = features.reduce((sum, feature) => sum + feature.price, 0);
  const basePrice = referenceTotal - featuresTotal;
  if (basePrice < 0) {
    return {
      eligible: false,
      reason: `product.price (${referenceTotal}) is below frozen feature total (${featuresTotal})`,
    };
  }

  return {
    eligible: true,
    snapshot: {
      displayName: product.serviceName.trim(),
      category: product.category,
      startingNodeTitle: String(product.startingNodeTitle || "").trim(),
      totalPages: asFiniteNumber(product.totalPages),
      basePrice,
      referenceTotal,
      finalPrice,
      features,
    },
  };
};

const writeBackup = (records) => {
  const backupDir = path.join(__dirname, "..", "migration-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `custom-client-project-orders-before-snapshot-migration-${Date.now()}.json`
  );
  fs.writeFileSync(backupPath, JSON.stringify(records, null, 2));
  return backupPath;
};

const run = async () => {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required. No database connection was made.");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const customProducts = await productModel
      .find({ isCustomClientProject: true })
      .select("serviceName category startingNodeTitle totalPages price clientProjectFeatures")
      .lean();
    const productIds = customProducts.map((product) => product._id);
    const orders = productIds.length
      ? await orderModel
          .find({ productId: { $in: productIds } })
          .select("productId projectSnapshot isWebsiteProject totalAmount price originalPrice createdAt")
          .lean()
      : [];
    const productById = new Map(customProducts.map((product) => [String(product._id), product]));
    const referencedProductIds = new Set(orders.map((order) => String(order.productId)));
    const candidates = [];
    const skipped = [];

    for (const order of orders) {
      if (order.projectSnapshot) {
        skipped.push({ orderId: String(order._id), reason: "snapshot already present" });
        continue;
      }
      if (!order.isWebsiteProject) {
        skipped.push({ orderId: String(order._id), reason: "linked order is not a website project" });
        continue;
      }

      const product = productById.get(String(order.productId));
      const result = buildSnapshot({ order, product });
      if (!result.eligible) {
        skipped.push({ orderId: String(order._id), productId: String(order.productId), reason: result.reason });
        continue;
      }
      candidates.push({ order, product, snapshot: result.snapshot });
    }

    const orphanProducts = customProducts
      .filter((product) => !referencedProductIds.has(String(product._id)))
      .map((product) => ({ productId: String(product._id), serviceName: product.serviceName }));

    console.log(`\nMode: ${shouldApply ? "APPLY (writes order snapshots only)" : "DRY RUN (read-only)"}`);
    console.log(`Custom hidden products found: ${customProducts.length}`);
    console.log(`Orders referencing them: ${orders.length}`);
    console.log(`Eligible order snapshots: ${candidates.length}`);
    console.log(`Skipped orders: ${skipped.length}`);
    console.log(`Orphan custom products: ${orphanProducts.length}`);

    candidates.forEach(({ order, product, snapshot }) => {
      console.log(`ELIGIBLE order=${order._id} product=${product._id} name=${snapshot.displayName} finalPrice=${snapshot.finalPrice}`);
    });
    skipped.forEach((entry) => console.log(`SKIPPED order=${entry.orderId} reason=${entry.reason}`));
    orphanProducts.forEach((entry) => console.log(`ORPHAN product=${entry.productId} name=${entry.serviceName || "(unnamed)"}`));

    if (!shouldApply) {
      console.log("\nDry run complete. No database records were changed.");
      return;
    }

    if (skipped.length) {
      throw new Error("Migration aborted: resolve skipped orders before applying any snapshot changes.");
    }

    const backupPath = writeBackup(candidates.map(({ order }) => order));
    console.log(`Backup written: ${backupPath}`);

    for (const { order, snapshot } of candidates) {
      await orderModel.updateOne({ _id: order._id, projectSnapshot: null }, { $set: { projectSnapshot: snapshot } });
    }

    const migratedIds = candidates.map(({ order }) => order._id);
    const verifiedCount = migratedIds.length
      ? await orderModel.countDocuments({ _id: { $in: migratedIds }, projectSnapshot: { $ne: null } })
      : 0;
    if (verifiedCount !== candidates.length) {
      throw new Error(`Post-write verification failed: expected ${candidates.length}, found ${verifiedCount}.`);
    }
    console.log(`\nApplied and verified ${verifiedCount} order snapshot(s). Legacy products were not changed.`);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("Custom project snapshot migration failed:", error.message || error);
  process.exitCode = 1;
});
