// Migration: backfill an invoiceModel document for every PROJECT order that has none.
//
// Context (frontend/src/DOCS/47_...md, Phase 3): as of Phase 1, all three order-creation
// paths (createOrder.js, customerCreateCustomProjectOrder.js, adminCreateProjectOrder.js)
// create a project invoice at order time. Orders created BEFORE that change have no invoice,
// so "invoice pending" state is missing for them. This script gives each such order the
// invoice(s) it should have had, with status derived from the order's REAL paid state so
// nothing is falsely marked paid or unpaid.
//
// SAFE BY DEFAULT: dry-run unless --apply is passed. Dry-run only reads and prints what
// WOULD be created — no writes. --apply writes a backup snapshot first, then creates the
// invoices.
//
// Scope:
// - Only PROJECT orders: isWebsiteProject === true. Plans/updates use monthlyInvoiceModel
//   (separate system) and are never touched here.
// - Only orders that currently have ZERO invoiceModel documents. Orders that already have
//   an invoice (e.g. admin-created, or any post-Phase-1 order) are skipped.
// - Additive only: creates invoiceModel documents. Never edits the order or any other model.
//
// Status rule per order:
// - Partial (installments[]): one invoice per installment; installment.paid === true -> "paid"
//   (with paidDate), else "unpaid".
// - Full: one invoice; paymentComplete OR paidAmount >= total -> "paid", else "unpaid".
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const generateInvoiceNumber = require("../helpers/generateInvoiceNumber");
require("../models/userModel");
require("../models/productModel");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

const buildLineItems = (order) => {
  if (Array.isArray(order?.orderItems) && order.orderItems.length > 0) {
    return order.orderItems.map((item) => ({
      name: item.name,
      price: Number(item.finalPrice ?? item.originalPrice ?? 0),
    }));
  }
  return [{ name: order?.productId?.serviceName || "Project", price: getOrderTotal(order) }];
};

// Returns the list of invoice specs (not yet persisted) this order should have.
const planInvoicesForOrder = (order) => {
  const lineItems = buildLineItems(order);
  const invoiceDate = order.createdAt || new Date();

  const isPartial =
    Boolean(order.isPartialPayment) &&
    Array.isArray(order.installments) &&
    order.installments.length > 0;

  if (isPartial) {
    return order.installments.map((inst) => ({
      amount: Number(inst.amount || 0),
      installmentNumber: inst.installmentNumber,
      status: inst.paid ? "paid" : "unpaid",
      paidDate: inst.paid ? inst.paidDate || invoiceDate : null,
      invoiceDate,
      dueDate: inst.dueDate || invoiceDate,
      lineItems,
    }));
  }

  const total = getOrderTotal(order);
  const isPaid = Boolean(order.paymentComplete) || Number(order.paidAmount || 0) >= total;
  return [
    {
      amount: total,
      installmentNumber: undefined,
      status: isPaid ? "paid" : "unpaid",
      paidDate: isPaid ? order.updatedAt || invoiceDate : null,
      invoiceDate,
      dueDate: invoiceDate,
      lineItems,
    },
  ];
};

const writeBackup = (records) => {
  const backupDir = path.join(__dirname, "..", "migration-backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const filePath = path.join(
    backupDir,
    `orders-before-invoice-backfill-${Date.now()}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  return filePath;
};

const run = async () => {
  const shouldApply = hasFlag("apply");

  await mongoose.connect(process.env.MONGODB_URI);

  const projectOrders = await orderProductModel
    .find({ isWebsiteProject: true })
    .populate("productId", "serviceName")
    .populate("userId", "email");

  // Which of those already have at least one invoice?
  const orderIds = projectOrders.map((o) => o._id);
  const existingInvoiceOrderIds = new Set(
    (await invoiceModel.find({ orderId: { $in: orderIds } }).select("orderId").lean()).map(
      (inv) => String(inv.orderId)
    )
  );

  const needBackfill = projectOrders.filter(
    (o) => !existingInvoiceOrderIds.has(String(o._id))
  );

  console.log(`\nMode: ${shouldApply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Total project orders: ${projectOrders.length}`);
  console.log(`Already have invoice(s): ${projectOrders.length - needBackfill.length}`);
  console.log(`Need backfill: ${needBackfill.length}\n`);

  const plan = needBackfill.map((order) => ({
    orderId: order._id.toString(),
    customerEmail: order.userId?.email,
    service: order.productId?.serviceName,
    total: getOrderTotal(order),
    isPartial: Boolean(order.isPartialPayment) && (order.installments || []).length > 0,
    invoices: planInvoicesForOrder(order).map((inv) => ({
      amount: inv.amount,
      installmentNumber: inv.installmentNumber ?? null,
      status: inv.status,
    })),
  }));

  plan.forEach((p) => {
    console.log("----------------------------------------------------");
    console.log(`Order: ${p.orderId} | Customer: ${p.customerEmail} | ${p.service}`);
    console.log(`Total: ${p.total} | Partial: ${p.isPartial}`);
    console.log("Invoices to create:", JSON.stringify(p.invoices, null, 2));
  });

  if (!shouldApply) {
    console.log("\nDry run complete. No changes written. Re-run with --apply to create these invoices.");
    await mongoose.disconnect();
    return;
  }

  const backupSnapshot = needBackfill.map((o) => o.toObject());
  const backupPath = writeBackup(backupSnapshot);
  console.log(`\nBackup written before applying changes: ${backupPath}`);

  let created = 0;
  for (const order of needBackfill) {
    const specs = planInvoicesForOrder(order);
    // Sequential — generateInvoiceNumber() reads the last number and would race concurrently.
    for (const spec of specs) {
      const invoiceNumber = await generateInvoiceNumber();
      await invoiceModel.create({
        userId: order.userId?._id || order.userId,
        orderId: order._id,
        invoiceNumber,
        invoiceType: "project",
        amount: spec.amount,
        status: spec.status,
        invoiceDate: spec.invoiceDate,
        dueDate: spec.dueDate,
        ...(spec.paidDate ? { paidDate: spec.paidDate } : {}),
        ...(spec.installmentNumber ? { installmentNumber: spec.installmentNumber } : {}),
        lineItems: spec.lineItems,
      });
      created += 1;
    }
  }

  console.log(`\nApplied. Created ${created} invoice(s) across ${needBackfill.length} order(s).`);
  console.log("No order or other model was modified — invoices are additive only.");

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  });
