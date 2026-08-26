// One-time cleanup: permanently delete invoiceModel records left behind by PAST project/plan
// deletions that happened before deleteOrder.js started writing deletedProjectName/deletedProjectType.
//
// Context: deleteOrder.js hard-deletes the order but never cascaded invoiceModel, so any
// invoice whose orderId no longer resolves to a real order was left "orphaned" — surfaced in
// the admin "Deleted Projects" tab with a generic "Deleted Project" label because it carries
// no name/type snapshot. Going forward, deleteOrder.js writes that snapshot before deleting,
// so only invoices from BEFORE this fix are affected. This script removes those stale,
// unlabeled orphans so the tab starts clean for the new feature.
//
// SAFE BY DEFAULT: dry-run unless --apply is passed. Dry-run only reads and prints what
// WOULD be deleted — no writes.
//
// Scope: only invoiceModel documents where orderId does not resolve to any existing order
// AND deletedProjectName is not already set (i.e. pre-fix orphans only — never touches an
// invoice that already has its snapshot, even if created after this script exists).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const invoiceModel = require("../models/invoiceModel");
const orderModel = require("../models/orderProductModel");
const connectDB = require("../config/db");

const APPLY = process.argv.includes("--apply");

const purgeOrphanedDeletedProjectInvoices = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");
    console.log(APPLY ? "⚠️  APPLY mode — will delete matching invoices" : "ℹ️  DRY RUN — no writes will be made (pass --apply to actually delete)");

    const invoices = await invoiceModel.find({ deletedProjectName: null }).select("orderId invoiceNumber amount status createdAt").lean();
    if (invoices.length === 0) {
      console.log("No invoices without a deletedProjectName snapshot found. Nothing to check.");
      process.exit(0);
    }

    const orderIds = invoices.map((invoice) => invoice.orderId).filter(Boolean);
    const existingOrders = await orderModel.find({ _id: { $in: orderIds } }).select("_id").lean();
    const existingOrderIdSet = new Set(existingOrders.map((order) => String(order._id)));

    const orphanedInvoices = invoices.filter((invoice) => !existingOrderIdSet.has(String(invoice.orderId)));

    if (orphanedInvoices.length === 0) {
      console.log("No orphaned invoices found. Nothing to purge.");
      process.exit(0);
    }

    console.log(`Found ${orphanedInvoices.length} orphaned invoice(s) from projects/plans deleted before the snapshot fix:`);
    orphanedInvoices.forEach((invoice) => {
      console.log(`  - ${invoice.invoiceNumber} · amount ${invoice.amount} · status ${invoice.status} · created ${invoice.createdAt?.toISOString?.() || invoice.createdAt}`);
    });

    if (!APPLY) {
      console.log("\nDry run complete. Re-run with --apply to permanently delete these invoices.");
      process.exit(0);
    }

    const idsToDelete = orphanedInvoices.map((invoice) => invoice._id);
    const result = await invoiceModel.deleteMany({ _id: { $in: idsToDelete } });
    console.log(`✅ Permanently deleted ${result.deletedCount} orphaned invoice(s).`);
    console.log("🎉 Purge completed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Purge error:", err);
    process.exit(1);
  }
};

purgeOrphanedDeletedProjectInvoices();
