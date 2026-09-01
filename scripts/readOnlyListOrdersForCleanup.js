// READ-ONLY inventory script. Does not write/update/delete anything.
//
// Purpose: give the owner one complete list of every order in the database, with the facts a
// delete decision actually needs — who owns it, what it cost, what money is attached to it,
// whether anything else points at it — so old/confusing records can be picked for removal
// deliberately rather than by guesswork.
//
// It deliberately does NOT recommend what to delete. It reports, and it flags the things that
// make a delete unsafe or lossy, because helpers/orderDeletePlan.js (the real delete path) has
// its own required checks and this script must not imply they can be skipped.
//
// Grouped by customer so a client's whole footprint is visible together, since deleting one
// order out of a client's history is what creates confusion rather than removing it.
//
// Run:  node scripts/readOnlyListOrdersForCleanup.js
//       node scripts/readOnlyListOrdersForCleanup.js --csv > orders.csv
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
const userModel = require("../models/userModel");
const { getOrderAmountReceived } = require("../helpers/orderPaymentTotals");
require("../models/productModel"); // register 'product' so populate('productId') works

const CSV = process.argv.includes("--csv");
const line = (s = "") => console.log(s);
const sep = () => line("=".repeat(100));
const money = (v) => Number(Number(v || 0).toFixed(2));

const nameOf = (o) =>
  o.projectSnapshot?.displayName ||
  o.productId?.serviceName ||
  o.servicePlanSnapshot?.serviceName ||
  (o.orderItems || []).find((i) => i.type === "main")?.name ||
  o.orderItems?.[0]?.name ||
  "(unnamed)";

const typeOf = (o) => {
  if (o.isServicePlan) return "service";
  if (o.isWebsiteProject) return "project";
  return "plan/other";
};

const ageDays = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null);
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  if (!CSV) line("target database host : " + host);
  await mongoose.connect(uri);
  if (!CSV) line("connected (read-only inventory - this script never writes)");

  const orders = await orderProductModel
    .find({})
    .populate("productId", "serviceName category")
    .sort({ createdAt: 1 })
    .lean();

  // ---- enrich every order with the facts a delete decision needs ----
  const rows = [];
  for (const o of orders) {
    const user = o.userId ? await userModel.findById(o.userId).select("name email").lean() : null;
    const txns = await transactionModel.find({ orderId: o._id }).select("status type amount").lean();
    const invoices = await invoiceModel.find({ orderId: o._id }).select("status amount amountPaid").lean();
    const received = money(await getOrderAmountReceived(o._id));

    // Anything that points AT this order — deleting it would orphan these.
    const linkedServices = await orderProductModel
      .find({ linkedProjectOrderId: o._id })
      .select("_id servicePlanSnapshot productId servicePlanStatus orderVisibility")
      .populate("productId", "serviceName")
      .lean();

    rows.push({
      o,
      user,
      received,
      txnCount: txns.length,
      txnCompleted: txns.filter((t) => t.status === "completed").length,
      txnPending: txns.filter((t) => t.status === "pending").length,
      invoiceCount: invoices.length,
      invoiceUnpaid: invoices.filter((i) => ["unpaid", "overdue", "partially_paid"].includes(i.status)).length,
      nodes: (o.projectNodes || []).length,
      linkedServices,
      refunded: Number(o.refundTotal || 0) > 0 || (Array.isArray(o.refunds) && o.refunds.length > 0),
    });
  }

  // ---- CSV mode: one row per order, for a spreadsheet ----
  if (CSV) {
    line([
      "orderId", "name", "type", "customer", "email", "createdAt", "ageDays",
      "price", "storedPaidAmount", "derivedReceived", "orderVisibility", "status",
      "progress", "nodes", "transactions", "completedTxns", "pendingTxns",
      "invoices", "unpaidInvoices", "linkedServices", "refunded",
    ].join(","));
    for (const r of rows) {
      const o = r.o;
      line([
        o._id,
        '"' + nameOf(o).replace(/"/g, "'") + '"',
        typeOf(o),
        '"' + (r.user?.name || "(no user)").replace(/"/g, "'") + '"',
        r.user?.email || "",
        fmt(o.createdAt),
        ageDays(o.createdAt),
        money(o.price ?? o.totalAmount),
        money(o.paidAmount),
        r.received,
        o.orderVisibility,
        o.status,
        o.projectProgress ?? "",
        r.nodes,
        r.txnCount,
        r.txnCompleted,
        r.txnPending,
        r.invoiceCount,
        r.invoiceUnpaid,
        r.linkedServices.length,
        r.refunded ? "yes" : "no",
      ].join(","));
    }
    await mongoose.disconnect();
    return;
  }

  // ---- grouped report, by customer ----
  const byUser = new Map();
  for (const r of rows) {
    const key = r.user ? String(r.user._id) : "(no user)";
    if (!byUser.has(key)) byUser.set(key, { user: r.user, items: [] });
    byUser.get(key).items.push(r);
  }

  line("");
  sep();
  line("ALL ORDERS IN THE DATABASE  (" + rows.length + " total, grouped by customer, oldest first)");
  sep();

  for (const [, group] of byUser) {
    line("");
    line("CUSTOMER: " + (group.user?.name || "(no user record)") + "   " + (group.user?.email || ""));
    line("-".repeat(100));

    for (const r of group.items) {
      const o = r.o;
      const flags = [];
      if (r.txnCompleted > 0) flags.push("HAS REAL MONEY (" + r.txnCompleted + " completed txn, " + r.received + ")");
      if (r.txnPending > 0) flags.push("PENDING PAYMENT x" + r.txnPending);
      if (r.invoiceUnpaid > 0) flags.push("UNPAID INVOICE x" + r.invoiceUnpaid);
      if (r.linkedServices.length) flags.push("LINKED SERVICES x" + r.linkedServices.length);
      if (r.refunded) flags.push("REFUNDED");
      if (r.txnCount === 0 && r.invoiceCount === 0) flags.push("NO MONEY RECORDS AT ALL");
      if (o.orderVisibility === "cancelled") flags.push("CANCELLED");

      line("");
      line("  " + o._id + "   " + nameOf(o));
      line("     type/created  : " + typeOf(o) + "   " + fmt(o.createdAt) + "   (" + ageDays(o.createdAt) + " days old)");
      line("     price         : " + money(o.price ?? o.totalAmount) +
           "   storedPaid: " + money(o.paidAmount) + "   derivedReceived: " + r.received);
      line("     state         : visibility=" + o.orderVisibility + "  status=" + o.status +
           "  progress=" + (o.projectProgress ?? "-") + "%  nodes=" + r.nodes);
      line("     money records : " + r.txnCount + " transaction(s), " + r.invoiceCount + " invoice(s)");
      if (r.linkedServices.length) {
        r.linkedServices.forEach((s) =>
          line("        linked service: " + s._id + "  " +
               (s.servicePlanSnapshot?.serviceName || s.productId?.serviceName || "(unnamed)") +
               "  [" + (s.servicePlanStatus || s.orderVisibility) + "]"));
      }
      line("     FLAGS         : " + (flags.length ? flags.join("  |  ") : "none"));
    }
  }

  // ---- summary buckets, to make the picking easier ----
  line("");
  sep();
  line("SUMMARY BUCKETS  (these are facts, not recommendations)");
  sep();

  const noMoney = rows.filter((r) => r.txnCount === 0 && r.invoiceCount === 0);
  const withMoney = rows.filter((r) => r.txnCompleted > 0);
  const linked = rows.filter((r) => r.linkedServices.length > 0);
  const pending = rows.filter((r) => r.txnPending > 0 || r.invoiceUnpaid > 0);
  const overpaid = rows.filter((r) => r.received > money(r.o.price ?? r.o.totalAmount) && r.received > 0);

  line("");
  line("  A. NO money records at all (no transaction, no invoice) : " + noMoney.length);
  line("     -> nothing financial is lost by deleting these.");
  noMoney.forEach((r) => line("       " + r.o._id + "  " + nameOf(r.o) + "  (" + fmt(r.o.createdAt) + ", " + typeOf(r.o) + ")"));

  line("");
  line("  B. HAS completed money  : " + withMoney.length);
  line("     -> deleting removes real payment history. orderDeletePlan.js requires explicit sections for these.");
  withMoney.forEach((r) => line("       " + r.o._id + "  " + nameOf(r.o) + "  received=" + r.received));

  line("");
  line("  C. Has LINKED services pointing at it : " + linked.length);
  line("     -> orderDeletePlan.js will not let these go until the services are handled.");
  linked.forEach((r) => line("       " + r.o._id + "  " + nameOf(r.o) + "  linked=" + r.linkedServices.length));

  line("");
  line("  D. Has PENDING payment / UNPAID invoice : " + pending.length);
  line("     -> money is still in flight; deleting loses the claim.");
  pending.forEach((r) => line("       " + r.o._id + "  " + nameOf(r.o)));

  line("");
  line("  E. Received MORE than the order price : " + overpaid.length);
  line("     -> worth understanding before deciding; the price or the payments may be wrong.");
  overpaid.forEach((r) => line("       " + r.o._id + "  " + nameOf(r.o) +
    "  price=" + money(r.o.price ?? r.o.totalAmount) + "  received=" + r.received));

  line("");
  sep();
  line("NOTE: this script only lists. Deleting is done by the app's own delete path");
  line("(controller/order/deleteOrder.js + helpers/orderDeletePlan.js), which enforces its own");
  line("checks. Nothing here was modified.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Inventory failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
