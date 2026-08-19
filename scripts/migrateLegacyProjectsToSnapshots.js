// Phase 2: remove the legacy project catalogue dependency without duplicating
// project state. Each client project remains one order document; its frozen
// projectSnapshot becomes the presentation/commercial record.
//
// Modes are intentionally separate and backup-first:
//   node scripts/migrateLegacyProjectsToSnapshots.js                       # read-only audit
//   node scripts/migrateLegacyProjectsToSnapshots.js --apply-snapshots     # writes snapshots only
//   node scripts/migrateLegacyProjectsToSnapshots.js --detach              # removes legacy order/contact links
//   node scripts/migrateLegacyProjectsToSnapshots.js --delete-legacy-products # permanently removes catalogue rows
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const productModel = require("../models/productModel");

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const mode = ["--apply-snapshots", "--detach", "--delete-legacy-products"].find((flag) => process.argv.includes(flag)) || "--dry-run";
const asNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const stringValue = (value) => String(value || "").trim();
const withoutBaseSuffix = (name) => stringValue(name).replace(/\s*\(Base\)$/i, "").trim();
const projectQuery = { isWebsiteProject: true, productId: { $ne: null } };

const writeBackup = (label, records) => {
  const backupDir = path.join(__dirname, "..", "migration-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `legacy-project-catalogue-${label}-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(records, null, 2));
  return backupPath;
};

const orderFinalPrice = (order) => asNumber(order.totalAmount ?? order.price ?? order.originalPrice);

const buildSnapshot = ({ order, product }) => {
  const mainItem = (order.orderItems || []).find((item) => item.type === "main");
  const featureItems = (order.orderItems || []).filter((item) => item.type === "feature");
  const name = withoutBaseSuffix(mainItem?.name) || stringValue(product.serviceName);
  const finalPrice = orderFinalPrice(order);
  const missing = [];
  if (!name) missing.push("project name");
  if (!PROJECT_CATEGORIES.includes(product.category)) missing.push("project category");
  if (finalPrice === null || finalPrice < 0) missing.push("order final price");

  let basePrice;
  let referenceTotal;
  let features;
  let priceSource;
  if (mainItem) {
    basePrice = asNumber(mainItem.originalPrice ?? mainItem.finalPrice);
    features = featureItems.map((item) => ({
      featureId: mongoose.Types.ObjectId.isValid(item.id) ? new mongoose.Types.ObjectId(item.id) : undefined,
      name: stringValue(item.name),
      price: asNumber(item.originalPrice ?? item.finalPrice),
    }));
    if (basePrice === null || basePrice < 0) missing.push("frozen main order item price");
    features.forEach((feature, index) => {
      if (!feature.name) missing.push(`frozen feature ${index + 1} name`);
      if (feature.price === null || feature.price < 0) missing.push(`frozen feature ${index + 1} price`);
    });
    referenceTotal = basePrice === null || features.some((feature) => feature.price === null)
      ? null
      : basePrice + features.reduce((total, feature) => total + feature.price, 0);
    priceSource = "frozen orderItems";
  } else {
    features = (product.clientProjectFeatures || []).map((feature) => ({
      featureId: feature.featureId,
      name: stringValue(feature.name),
      price: asNumber(feature.price),
    }));
    referenceTotal = asNumber(product.price);
    features.forEach((feature, index) => {
      if (!feature.name) missing.push(`legacy feature ${index + 1} name`);
      if (feature.price === null || feature.price < 0) missing.push(`legacy feature ${index + 1} price`);
    });
    const featureTotal = features.reduce((total, feature) => total + (feature.price || 0), 0);
    basePrice = referenceTotal === null ? null : referenceTotal - featureTotal;
    if (referenceTotal === null || referenceTotal < 0) missing.push("legacy product reference price");
    if (basePrice === null || basePrice < 0) missing.push("legacy product base price");
    priceSource = "legacy private/catalogue product (no frozen orderItems)";
  }
  if (referenceTotal === null || referenceTotal < 0) missing.push("reference total");
  if (missing.length) return { eligible: false, reason: [...new Set(missing)].join(", ") };

  return {
    eligible: true,
    priceSource,
    snapshot: {
      displayName: name,
      category: product.category,
      startingNodeTitle: stringValue(product.startingNodeTitle),
      totalPages: asNumber(product.totalPages) ?? undefined,
      basePrice,
      referenceTotal,
      finalPrice,
      features,
    },
  };
};

const loadState = async () => {
  const products = await productModel.find({ category: { $in: PROJECT_CATEGORIES } })
    .select("serviceName category startingNodeTitle totalPages price clientProjectFeatures")
    .lean();
  const productIds = products.map((product) => product._id);
  const productById = new Map(products.map((product) => [String(product._id), product]));
  const orders = await orderModel.find(projectQuery)
    .select("_id productId projectSnapshot isWebsiteProject totalAmount price originalPrice orderItems createdAt")
    .lean();
  const candidates = [];
  const skipped = [];
  for (const order of orders) {
    const product = productById.get(String(order.productId));
    if (!product) {
      skipped.push({ orderId: String(order._id), reason: "linked project product is outside the project catalogue set" });
      continue;
    }
    if (order.projectSnapshot) continue;
    const result = buildSnapshot({ order, product });
    if (!result.eligible) {
      skipped.push({ orderId: String(order._id), productId: String(product._id), reason: result.reason });
      continue;
    }
    candidates.push({ order, product, ...result });
  }
  const contacts = productIds.length
    ? await mongoose.connection.db.collection("contactrequests").find({ productId: { $in: productIds } }).toArray()
    : [];
  return { products, productIds, productById, orders, candidates, skipped, contacts };
};

const report = ({ products, orders, candidates, skipped, contacts }) => {
  const orderItemBacked = candidates.filter((candidate) => candidate.priceSource === "frozen orderItems").length;
  console.log(`Mode: ${mode}`);
  console.log(`Legacy project catalogue products: ${products.length}`);
  console.log(`Legacy project orders still linked: ${orders.length}`);
  console.log(`Orders eligible for a new snapshot: ${candidates.length}`);
  console.log(`Eligible snapshots using frozen order items: ${orderItemBacked}`);
  console.log(`Eligible snapshots using the legacy product because order items are absent: ${candidates.length - orderItemBacked}`);
  console.log(`Orders blocked from migration: ${skipped.length}`);
  console.log(`Historic contact requests still linked: ${contacts.length}`);
  skipped.forEach((entry) => console.log(`BLOCKED order=${entry.orderId} reason=${entry.reason}`));
};

const assertNoBlockedSnapshots = (state) => {
  if (state.skipped.length) throw new Error("Migration aborted: one or more linked projects cannot be represented exactly.");
};

const applySnapshots = async (state) => {
  assertNoBlockedSnapshots(state);
  if (!state.candidates.length) return console.log("No missing project snapshots to write.");
  const backupPath = writeBackup("before-snapshot", state.candidates.map(({ order, product }) => ({ order, product })));
  const writes = await Promise.all(state.candidates.map(({ order, snapshot }) =>
    orderModel.updateOne({ _id: order._id, projectSnapshot: null }, { $set: { projectSnapshot: snapshot } })
  ));
  if (writes.some((result) => result.modifiedCount !== 1)) throw new Error("Snapshot write verification failed before completion.");
  console.log(`Snapshot backup: ${backupPath}`);
  console.log(`Snapshots written and verified: ${writes.length}`);
};

const detachLegacyReferences = async (state) => {
  const unsnapshotted = await orderModel.countDocuments({ ...projectQuery, projectSnapshot: null });
  if (unsnapshotted) throw new Error(`Detach aborted: ${unsnapshotted} linked project order(s) still have no snapshot.`);
  const linkedOrders = await orderModel.find(projectQuery).lean();
  const contactSnapshots = state.contacts.map((contact) => {
    const product = state.productById.get(String(contact.productId));
    return {
      contactId: contact._id,
      productId: contact.productId,
      snapshot: { displayName: product?.serviceName || "Legacy project", category: product?.category || "" },
    };
  });
  const backupPath = writeBackup("before-detach", { orders: linkedOrders, contacts: state.contacts });
  if (linkedOrders.length) await orderModel.updateMany(projectQuery, { $set: { productId: null } });
  for (const contact of contactSnapshots) {
    await mongoose.connection.db.collection("contactrequests").updateOne(
      { _id: contact.contactId },
      { $set: { legacyProductSnapshot: contact.snapshot }, $unset: { productId: "" } }
    );
  }
  const remainingOrders = await orderModel.countDocuments(projectQuery);
  const remainingContacts = state.productIds.length
    ? await mongoose.connection.db.collection("contactrequests").countDocuments({ productId: { $in: state.productIds } })
    : 0;
  if (remainingOrders || remainingContacts) throw new Error(`Detach verification failed: orders=${remainingOrders}, contacts=${remainingContacts}.`);
  console.log(`Detach backup: ${backupPath}`);
  console.log(`Detached orders: ${linkedOrders.length}; migrated contacts: ${contactSnapshots.length}`);
};

const deleteLegacyProducts = async (state) => {
  const [orderReferences, contactReferences] = await Promise.all([
    orderModel.countDocuments({ productId: { $in: state.productIds } }),
    state.productIds.length ? mongoose.connection.db.collection("contactrequests").countDocuments({ productId: { $in: state.productIds } }) : 0,
  ]);
  if (orderReferences || contactReferences) throw new Error(`Delete aborted: remaining product references orders=${orderReferences}, contacts=${contactReferences}.`);
  const backupPath = writeBackup("before-product-delete", state.products);
  const deleted = await productModel.deleteMany({ _id: { $in: state.productIds }, category: { $in: PROJECT_CATEGORIES } });
  const remaining = await productModel.countDocuments({ category: { $in: PROJECT_CATEGORIES } });
  if (remaining) throw new Error(`Delete verification failed: ${remaining} legacy project catalogue product(s) remain.`);
  console.log(`Product backup: ${backupPath}`);
  console.log(`Legacy project catalogue products deleted: ${deleted.deletedCount}`);
};

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required. No database connection was made.");
  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const state = await loadState();
    report(state);
    if (mode === "--dry-run") return console.log("Dry run complete. No database record was changed.");
    if (mode === "--apply-snapshots") return await applySnapshots(state);
    if (mode === "--detach") return await detachLegacyReferences(state);
    return await deleteLegacyProducts(state);
  } finally {
    await mongoose.disconnect();
  }
};

run().catch((error) => {
  console.error("Legacy project catalogue migration failed:", error.message || error);
  process.exitCode = 1;
});
