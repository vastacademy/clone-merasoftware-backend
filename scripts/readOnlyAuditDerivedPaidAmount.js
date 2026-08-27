// READ-ONLY audit. Writes nothing.
//
// Question this answers, with data instead of reasoning:
//   If "how much has been paid" were DERIVED from completed transactions
//   (the proposed single source of truth) instead of being incremented by hand
//   in 9 different places, would any PROJECT order's numbers change?
//
// For every order it prints, side by side:
//   stored   = order.paidAmount / invoice.amountPaid as they are today
//   derived  = sum of that order's COMPLETED transactions (pending never counts)
// and flags a MISMATCH when they disagree.
//
// It separates PROJECT orders from SERVICE-PLAN orders, because the plan flow is
// the one being fixed and the project flow must come out regression-free.
//
// Run:  node scripts/readOnlyAuditDerivedPaidAmount.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
require("../models/productModel");

const line = (s = "") => console.log(s);
const sep = () => line("=".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

// Money that has actually been received = completed transactions only.
// Refunds are subtracted; pending/rejected never count.
const derivePaidFromTransactions = (txns) =>
  txns.reduce((total, t) => {
    if (t.status !== "completed") return total;
    if (t.type === "refund") return total - Number(t.amount || 0);
    if (t.type === "deposit") return total; // wallet recharge is not order money
    return total + Number(t.amount || 0);
  }, 0);

const auditGroup = async (label, orders) => {
  sep();
  line(`${label} — ${orders.length} order(s)`);
  sep();

  let mismatchOrders = 0;
  let mismatchInvoices = 0;
  const details = [];

  for (const order of orders) {
    const txns = await transactionModel.find({ orderId: order._id }).lean();
    const derived = derivePaidFromTransactions(txns);
    const stored = Number(order.paidAmount || 0);
    const orderMismatch = Math.abs(derived - stored) > 0.01;

    const invoices = await invoiceModel.find({ orderId: order._id }).lean();
    // Statement-type invoices are roll-ups of other invoices, not payment targets.
    const payable = invoices.filter(
      (i) => !["project_final", "service_statement"].includes(i.invoiceType)
    );
    const storedInvoicePaid = payable.reduce((s, i) => s + Number(i.amountPaid || 0), 0);
    const invoiceMismatch = Math.abs(derived - storedInvoicePaid) > 0.01;

    if (orderMismatch) mismatchOrders += 1;
    if (invoiceMismatch) mismatchInvoices += 1;

    if (orderMismatch || invoiceMismatch) {
      const pending = txns.filter((t) => t.status === "pending");
      details.push({
        id: String(order._id),
        name:
          order.projectSnapshot?.displayName ||
          order.servicePlanSnapshot?.serviceName ||
          order.productId?.serviceName ||
          "(unnamed)",
        total: money(order.totalAmount ?? order.price),
        stored: money(stored),
        storedInvoicePaid: money(storedInvoicePaid),
        derived: money(derived),
        installments: Array.isArray(order.installments) ? order.installments.length : 0,
        txnCount: txns.length,
        pendingCount: pending.length,
        pendingAmt: money(pending.reduce((s, t) => s + Number(t.amount || 0), 0)),
        visibility: order.orderVisibility,
      });
    }
  }

  line(`order.paidAmount mismatches   : ${mismatchOrders} / ${orders.length}`);
  line(`invoice.amountPaid mismatches : ${mismatchInvoices} / ${orders.length}`);

  if (details.length) {
    line("");
    line("MISMATCH DETAIL:");
    details.forEach((d) => {
      line("");
      line(`  ${d.id}  ${d.name}`);
      line(`    order total            : ${d.total}`);
      line(`    stored order.paidAmount: ${d.stored}`);
      line(`    stored invoice paid sum: ${d.storedInvoicePaid}`);
      line(`    DERIVED (completed txn): ${d.derived}`);
      line(`    installments           : ${d.installments}`);
      line(`    transactions           : ${d.txnCount}  (pending: ${d.pendingCount}, amount ${d.pendingAmt})`);
      line(`    orderVisibility        : ${d.visibility}`);
    });
  }
  line("");
  return { mismatchOrders, mismatchInvoices, total: orders.length };
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI in .env");
    process.exit(1);
  }
  await mongoose.connect(uri);
  line("connected (READ-ONLY — this script never writes)");
  line("");

  const all = await orderProductModel.find({}).populate("productId", "serviceName category").lean();

  const services = all.filter((o) => o.isServicePlan);
  const projects = all.filter((o) => !o.isServicePlan);

  const projectResult = await auditGroup("PROJECT / OTHER ORDERS (must stay regression-free)", projects);
  const serviceResult = await auditGroup("SERVICE-PLAN ORDERS (the flow being fixed)", services);

  sep();
  line("VERDICT");
  sep();
  line(`Projects with changed numbers if derived: ${projectResult.mismatchOrders} order-level, ${projectResult.mismatchInvoices} invoice-level (of ${projectResult.total})`);
  line(`Services with changed numbers if derived: ${serviceResult.mismatchOrders} order-level, ${serviceResult.mismatchInvoices} invoice-level (of ${serviceResult.total})`);
  line("");
  if (projectResult.mismatchOrders === 0 && projectResult.mismatchInvoices === 0) {
    line("=> Deriving would produce IDENTICAL numbers for every project order.");
  } else {
    line("=> Deriving would CHANGE some project numbers — inspect the detail above before proceeding.");
  }

  await mongoose.disconnect();
  line("");
  line("done (nothing was modified)");
};

main().catch(async (error) => {
  console.error("Audit failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
