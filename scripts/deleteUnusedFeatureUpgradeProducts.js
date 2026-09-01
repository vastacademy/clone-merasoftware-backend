/**
 * Deletes the 8 remaining `feature_upgrades` catalogue products from the old system.
 *
 * DRY RUN BY DEFAULT — prints the full dependency picture for each product and writes nothing.
 * Pass --apply to delete.
 *
 * Background: the clone's catalogue holds 11 products. Eight are `feature_upgrades` rows created
 * in Feb 2025 and belong to the old system the owner is retiring; the other three are the
 * current `service_plan` products created Aug 2026 (Starter Update Plan, Live Chat Feature,
 * Single Page Adition), two of which are live on a customer's orders. Only the eight are
 * targeted here — the three current plans are not in the list and are never touched.
 *
 * WHY THIS DOES NOT USE deleteUnusedPlans.js's "zero orders or keep" RULE:
 * that script refuses to delete a product any order references, because a live order pointing at
 * a missing product would lose its name. That protection does not apply here, and the reason was
 * verified rather than assumed:
 *
 *   - Seven of the eight ARE referenced by orders — but through `orderItems[].name`, a frozen
 *     purchase label, not through `productId`. Every one of these orders already carries
 *     productId: null; the catalogue link was severed long before this script.
 *   - getOrderDisplayName() (frontend/src/helpers/orderPresentation.js) resolves a name in this
 *     order: projectSnapshot.displayName -> productId.serviceName -> servicePlanSnapshot.
 *     serviceName -> orderItems[].name. With productId already null, these orders are ALREADY
 *     reading their name from orderItems[].name, so removing the catalogue row changes nothing
 *     they display.
 *   - The same thing has already happened to 25 other products from these screenshots
 *     (Restaurant Website, College Website, CRM Based CMS, ...): their catalogue rows are gone,
 *     their orders remain, and those orders render correctly today. This is the established
 *     outcome in this database, not a prediction.
 *
 * So the check below REPORTS every dependency instead of blocking on it, and the deletion is an
 * explicit owner decision recorded here. What it still refuses to touch:
 *
 *   - Any product outside TARGET_PRODUCT_IDS.
 *   - Any target that turns out to be referenced by a LIVE productId link — that would be a real
 *     orphan, different from the frozen-name references above, and aborts the whole batch.
 *
 * Orders, transactions, and invoices are never modified. Only the catalogue rows are removed.
 *
 * Usage:
 *   node scripts/deleteUnusedFeatureUpgradeProducts.js            # dry run
 *   node scripts/deleteUnusedFeatureUpgradeProducts.js --apply    # delete
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");

const apply = process.argv.includes("--apply");

// The 8 old feature_upgrades products, by _id. Targeted by id, not name: several names in this
// catalogue carry stray whitespace ("  WhatsApp Cloud API Integration  ") and a name match
// would silently miss them.
const TARGET_PRODUCT_IDS = [
  "67a8a67fc46161fd031d6dc2", // User Management                price 70000
  "67a8a704c46161fd031d6e43", // Payment Gateway                price 15000
  "67a8a783c46161fd031d6ec4", // Live Chat                      price 20000
  "67a8a7e9c46161fd031d6f45", // Product Inventory System       price 25000
  "67a8a84cc46161fd031d6fc6", // Dynamic Page with Panel        price  8000
  "67a8aa69c46161fd031d70c9", // WhatsApp Cloud API Integration price 18000
  "67a8ab65c46161fd031d714e", // Dynamic Gallery                price 20000
  "67ab511c7bc4940983e09ac9", // Add New Page                   price  3500
];

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.log("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  console.log(`target database host : ${host}`);
  await mongoose.connect(uri);

  console.log(`\n${apply ? "APPLY" : "DRY RUN"}`);
  console.log("=".repeat(78));

  const deletable = [];
  const blockers = [];
  const missing = [];

  for (const id of TARGET_PRODUCT_IDS) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      missing.push(`${id} — not a valid ObjectId`);
      continue;
    }

    const product = await productModel
      .findById(id)
      .select("_id serviceName category price sellingPrice isHidden createdAt")
      .lean();

    if (!product) {
      missing.push(`${id} — not found (already gone?)`);
      continue;
    }

    const name = String(product.serviceName || "").trim();
    const rx = new RegExp("^\\s*" + escapeRx(name) + "\\s*$", "i");

    // A LIVE catalogue link. This is the one that would orphan an order — it aborts the batch.
    const liveLinked = await orderModel
      .find({ productId: product._id })
      .select("_id userId orderVisibility")
      .lean();

    // Frozen purchase labels. These already survive without the catalogue row (see header).
    const byItemName = await orderModel
      .find({ "orderItems.name": rx })
      .select("_id userId orderVisibility productId")
      .lean();

    const bySnapshot = await orderModel
      .find({ "servicePlanSnapshot.serviceName": rx })
      .select("_id userId orderVisibility productId")
      .lean();

    console.log(`\n"${name}"  (_id=${product._id})`);
    console.log(`   category : ${product.category}   price=${product.price}  selling=${product.sellingPrice}`);
    console.log(`   created  : ${product.createdAt ? new Date(product.createdAt).toISOString().slice(0, 10) : "-"}`);
    console.log(`   live productId links      : ${liveLinked.length}${liveLinked.length ? "   <-- BLOCKS DELETE" : ""}`);
    console.log(`   orders w/ frozen item name: ${byItemName.length}   (these keep their name without the catalogue row)`);
    console.log(`   orders w/ snapshot name   : ${bySnapshot.length}`);

    for (const order of byItemName) {
      const user = await userModel.findById(order.userId).select("email").lean();
      console.log(
        `      ${order._id} | ${user?.email || "?"} | ${order.orderVisibility}` +
          ` | productId=${order.productId || "null"}`
      );
    }

    if (liveLinked.length) {
      blockers.push(`${name} (${product._id}) — ${liveLinked.length} order(s) still link by productId`);
      for (const order of liveLinked) {
        const user = await userModel.findById(order.userId).select("email").lean();
        console.log(`      LIVE LINK: ${order._id} | ${user?.email || "?"} | ${order.orderVisibility}`);
      }
      console.log(`   => BLOCKED (a live productId link would be orphaned)`);
      continue;
    }

    console.log(`   => DELETE (owner-approved; no live productId link)`);
    deletable.push({ ...product, name, frozenRefs: byItemName.length + bySnapshot.length });
  }

  console.log(`\n${"-".repeat(78)}`);
  console.log(`Will delete : ${deletable.length}`);
  deletable.forEach((p) =>
    console.log(`   ${p.name}${p.frozenRefs ? `   (${p.frozenRefs} order(s) keep their frozen name)` : ""}`));
  if (blockers.length) {
    console.log(`Blocked     : ${blockers.length}`);
    blockers.forEach((b) => console.log(`   ${b}`));
  }
  if (missing.length) {
    console.log(`Not found   : ${missing.length}`);
    missing.forEach((m) => console.log(`   ${m}`));
  }

  if (blockers.length) {
    console.log(`\nAborting — a live productId link must be resolved first. Nothing was written.`);
    await mongoose.disconnect();
    process.exit(1);
  }

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
  console.log(`\nDeleted ${res.deletedCount} catalogue product(s). Orders were not modified.`);

  // Verify: every deleted product is gone, and the current service plans are untouched.
  for (const p of deletable) {
    const gone = !(await productModel.exists({ _id: p._id }));
    console.log(`   deleted "${p.name}" removed: ${gone}`);
  }
  const remaining = await productModel.find({}).select("serviceName category").lean();
  console.log(`\n   catalogue now holds ${remaining.length} product(s):`);
  remaining.forEach((p) => console.log(`      ${String(p.serviceName).trim()}  [${p.category}]`));

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
