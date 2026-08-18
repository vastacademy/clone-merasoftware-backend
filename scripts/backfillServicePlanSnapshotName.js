/**
 * Backfill `servicePlanSnapshot.serviceName` on service-plan orders bought before
 * that field existed.
 *
 * WHY the name is sourced from the INVOICE, not from the product:
 *   The whole point of this field is that the order must not depend on the catalog
 *   product row still existing. Backfilling from `productId.serviceName` would work
 *   today but would re-create the exact dependency we are removing — and would fail
 *   for any order whose product is already gone. The invoice froze the name at
 *   purchase time in `lineItems[].name`, which is the correct historical source.
 *   The product is used only as a last-resort fallback when no invoice line exists.
 *
 * Safe to re-run: orders that already have a name are skipped, never overwritten.
 *
 * Usage:
 *   node scripts/backfillServicePlanSnapshotName.js            # dry run (default)
 *   node scripts/backfillServicePlanSnapshotName.js --apply    # actually writes
 */

require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const orderModel = require("../models/orderProductModel");
  const invoiceModel = require("../models/invoiceModel");
  const productModel = require("../models/productModel");

  // Service-plan orders whose snapshot exists but carries no name yet.
  const orders = await orderModel
    .find({
      isServicePlan: true,
      servicePlanSnapshot: { $ne: null },
      $or: [
        { "servicePlanSnapshot.serviceName": { $exists: false } },
        { "servicePlanSnapshot.serviceName": null },
        { "servicePlanSnapshot.serviceName": "" },
      ],
    })
    .select("_id productId servicePlanSnapshot");

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${orders.length} order(s) need a name\n`);

  let filled = 0;
  let unresolved = 0;

  for (const order of orders) {
    // Preferred source: the invoice line frozen at purchase time.
    const invoice = await invoiceModel
      .findOne({ orderId: order._id, "lineItems.0": { $exists: true } })
      .select("lineItems")
      .lean();

    let name = invoice?.lineItems?.[0]?.name || null;
    let source = "invoice";

    // Last resort only — this is the dependency we are removing, so it is used
    // strictly when no invoice line exists.
    if (!name && order.productId) {
      const product = await productModel.findById(order.productId).select("serviceName").lean();
      name = product?.serviceName || null;
      source = "product (fallback)";
    }

    if (!name) {
      unresolved += 1;
      console.log(`  SKIP  ${order._id} — no invoice line and no product name`);
      continue;
    }

    console.log(`  ${APPLY ? "SET " : "WOULD SET"}  ${order._id} -> ${JSON.stringify(name)}  [${source}]`);

    if (APPLY) {
      // Targeted update: touches only this one nested key, so no other snapshot
      // field can be re-cast or lost.
      await orderModel.updateOne(
        { _id: order._id },
        { $set: { "servicePlanSnapshot.serviceName": name } }
      );
    }
    filled += 1;
  }

  console.log(
    `\n${APPLY ? "Filled" : "Would fill"}: ${filled}   Unresolved: ${unresolved}` +
      (APPLY ? "" : "\nRe-run with --apply to write these changes.")
  );

  await mongoose.disconnect();
})().catch((error) => {
  console.error("Backfill failed:", error.message);
  process.exit(1);
});
