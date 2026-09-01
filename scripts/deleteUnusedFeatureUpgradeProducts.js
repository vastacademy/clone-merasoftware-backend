/**
 * Deletes the 8 old `feature_upgrades` catalogue products, ONLY IF nothing depends on them.
 *
 * DRY RUN BY DEFAULT — prints the decision for each product and writes nothing.
 * Pass --apply to delete the ones that qualify.
 *
 * Background: the catalogue holds 11 products. Eight were created in Feb 2025 under the
 * `feature_upgrades` category and have never been bought — verified: zero orders reference them
 * by productId, and zero orders carry their name in a servicePlanSnapshot either. The other
 * three are the current service plans created in Aug 2026 (Starter Update Plan, Live Chat
 * Feature, Single Page Adition); two of them are live on a customer's orders and are NOT
 * touched here.
 *
 * This is a sibling of scripts/deleteUnusedPlans.js and keeps its rule verbatim, because the
 * rule is what makes the delete safe rather than merely convenient:
 *
 *   A product is deleted only when it has ZERO orders. If any customer ever bought it —
 *   active or not — the product is KEPT, because deleting it would leave that order pointing
 *   at a product that no longer exists.
 *
 * The check is deliberately stricter than deleteUnusedPlans.js in one way: it also counts
 * orders that merely carry the product's name in servicePlanSnapshot.serviceName. An order
 * whose catalogue product was already detached keeps that frozen name as its only remaining
 * label (see helpers/orderSummary.js and frontend/src/helpers/orderPresentation.js), so a
 * name still in use is evidence the product is not orphaned even when productId is null.
 *
 * Targeting is by _id, not by name. Names in this catalogue carry stray whitespace
 * ("  WhatsApp Cloud API Integration  "), so a name match would silently miss rows.
 *
 * Usage:
 *   node scripts/deleteUnusedFeatureUpgradeProducts.js            # dry run
 *   node scripts/deleteUnusedFeatureUpgradeProducts.js --apply    # delete the unused ones
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");

const apply = process.argv.includes("--apply");

// The 8 old feature_upgrades products, by _id (all created 2025-02, all unused).
const TARGET_PRODUCT_IDS = [
  "67a8a67fc46161fd031d6dc2", // User Management               price 70000
  "67a8a704c46161fd031d6e43", // Payment Gateway               price 15000
  "67a8a783c46161fd031d6ec4", // Live Chat                     price 20000
  "67a8a7e9c46161fd031d6f45", // Product Inventory System      price 25000
  "67a8a84cc46161fd031d6fc6", // Dynamic Page with Panel       price  8000
  "67a8aa69c46161fd031d70c9", // WhatsApp Cloud API Integration price 18000
  "67a8ab65c46161fd031d714e", // Dynamic Gallery               price 20000
  "67ab511c7bc4940983e09ac9", // Add New Page                  price  3500
];

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
  console.log("=".repeat(72));

  const deletable = [];
  const kept = [];
  const missing = [];

  for (const id of TARGET_PRODUCT_IDS) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      missing.push(`${id} — not a valid ObjectId`);
      continue;
    }

    const product = await productModel
      .find({ _id: id })
      .select("_id serviceName category price sellingPrice isHidden isServicePlan createdAt")
      .lean();

    if (!product.length) {
      missing.push(`${id} — not found (already gone?)`);
      continue;
    }

    for (const p of product) {
      const name = String(p.serviceName || "").trim();

      // Two ways an order can still depend on this product.
      const orders = await orderModel
        .find({ productId: p._id })
        .select("_id userId isActive orderVisibility paidAmount")
        .lean();

      const snapshotOrders = await orderModel
        .find({ "servicePlanSnapshot.serviceName": name })
        .select("_id userId orderVisibility")
        .lean();

      console.log(`\n"${name}"  (_id=${p._id})`);
      console.log(`   category : ${p.category}   price=${p.price}  selling=${p.sellingPrice}`);
      console.log(`   created  : ${p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "-"}`);
      console.log(`   orders by productId          : ${orders.length}`);
      console.log(`   orders by snapshot name      : ${snapshotOrders.length}`);

      for (const order of orders) {
        const user = await userModel.findById(order.userId).select("email").lean();
        console.log(
          `      ${order._id} | ${user?.email || "?"} | isActive=${order.isActive}` +
            ` | ${order.orderVisibility} | paid=${order.paidAmount}`
        );
      }
      for (const order of snapshotOrders) {
        const user = await userModel.findById(order.userId).select("email").lean();
        console.log(`      (snapshot) ${order._id} | ${user?.email || "?"} | ${order.orderVisibility}`);
      }

      const dependents = orders.length + snapshotOrders.length;
      if (dependents === 0) {
        console.log(`   => DELETE (nothing depends on it)`);
        deletable.push({ ...p, name });
      } else {
        console.log(`   => KEEP — ${dependents} order(s) depend on it`);
        kept.push({ product: { ...p, name }, orderCount: dependents });
      }
    }
  }

  console.log(`\n${"-".repeat(72)}`);
  console.log(`Will delete : ${deletable.length}`);
  deletable.forEach((p) => console.log(`   ${p.name}`));
  console.log(`Will keep   : ${kept.length}`);
  kept.forEach((k) => console.log(`   ${k.product.name} (${k.orderCount} order(s))`));
  if (missing.length) {
    console.log(`Not found   : ${missing.length}`);
    missing.forEach((m) => console.log(`   ${m}`));
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
  console.log(`\nDeleted ${res.deletedCount} catalogue product(s).`);

  // Verify: every kept product must still exist, every deleted one must be gone.
  for (const k of kept) {
    const still = await productModel.exists({ _id: k.product._id });
    console.log(`   kept "${k.product.name}" still present: ${Boolean(still)}`);
  }
  for (const p of deletable) {
    const gone = !(await productModel.exists({ _id: p._id }));
    console.log(`   deleted "${p.name}" removed: ${gone}`);
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
