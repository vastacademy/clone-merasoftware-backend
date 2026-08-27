// READ-ONLY forensics. Writes nothing.
//
// Purpose: for every order where stored paidAmount disagrees with the sum of
// completed transactions, open up the ACTUAL transactions and invoices and work
// out WHICH side is telling the truth — instead of assuming "derived" is right.
//
// Run:  node scripts/readOnlyAuditMismatchForensics.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel");
const transactionModel = require("../models/transactionModel");
require("../models/productModel");

const line = (s = "") => console.log(s);
const sep = () => line("=".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

const derivePaid = (txns) =>
  txns.reduce((total, t) => {
    if (t.status !== "completed") return total;
    if (t.type === "refund") return total - Number(t.amount || 0);
    if (t.type === "deposit") return total;
    return total + Number(t.amount || 0);
  }, 0);

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { line("No Mongo URI in .env"); process.exit(1); }
  await mongoose.connect(uri);
  line("connected (READ-ONLY forensics — never writes)");

  const all = await orderProductModel.find({}).populate("productId", "serviceName category").lean();

  for (const order of all) {
    const txns = await transactionModel.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
    const derived = derivePaid(txns);
    const stored = Number(order.paidAmount || 0);
    const invoices = await invoiceModel.find({ orderId: order._id }).lean();
    const monthly = await monthlyInvoiceModel.find({ orderId: order._id }).lean();
    const payable = invoices.filter((i) => !["project_final", "service_statement"].includes(i.invoiceType));
    const invPaid = payable.reduce((s, i) => s + Number(i.amountPaid || 0), 0);

    const orderMismatch = Math.abs(derived - stored) > 0.01;
    const invMismatch = Math.abs(derived - invPaid) > 0.01;
    if (!orderMismatch && !invMismatch) continue;

    sep();
    line(`${order.isServicePlan ? "SERVICE" : "PROJECT"}  ${order._id}`);
    line(`  name        : ${order.projectSnapshot?.displayName || order.servicePlanSnapshot?.serviceName || order.productId?.serviceName || "(unnamed)"}`);
    line(`  category    : ${order.productId?.category || "-"}`);
    line(`  total       : ${money(order.totalAmount ?? order.price)}`);
    line(`  createdAt   : ${order.createdAt}`);
    line(`  visibility  : ${order.orderVisibility}   status: ${order.status}`);
    line(`  installments: ${Array.isArray(order.installments) ? order.installments.length : 0}`);
    if (Array.isArray(order.installments) && order.installments.length) {
      order.installments.forEach((i) =>
        line(`     #${i.installmentNumber} amount=${money(i.amount)} paid=${i.paid} threshold=${i.progressThreshold ?? "-"}`)
      );
    }
    line("");
    line(`  stored order.paidAmount : ${money(stored)}`);
    line(`  invoice amountPaid sum  : ${money(invPaid)}   (payable invoices: ${payable.length})`);
    line(`  DERIVED completed txns  : ${money(derived)}`);
    line("");
    line(`  TRANSACTIONS (${txns.length}):`);
    txns.forEach((t) =>
      line(`    ${t.transactionId} | ${money(t.amount)} | ${t.paymentMethod} | ${t.type}/${t.sourceType} | ${t.status} | inst=${t.installmentNumber ?? "-"} | inv=${t.invoiceId ? "yes" : "no"} | ${t.createdAt}`)
    );
    line("");
    line(`  invoiceModel (${invoices.length}):`);
    invoices.forEach((i) =>
      line(`    ${i.invoiceNumber} | type=${i.invoiceType} | amount=${money(i.amount)} | paid=${money(i.amountPaid)} | ${i.status} | inst=${i.installmentNumber ?? "-"}`)
    );
    if (monthly.length) {
      line("");
      line(`  monthlyInvoiceModel (${monthly.length}):`);
      monthly.forEach((i) =>
        line(`    ${i.invoiceNumber} | amount=${money(i.amount)} | ${i.status}`)
      );
    }

    // --- interpretation ---
    line("");
    line("  READING:");
    const completed = txns.filter((t) => t.status === "completed");
    const pendingTx = txns.filter((t) => t.status === "pending");
    if (txns.length === 0) {
      line("    No transactions at all -> money was recorded WITHOUT a transaction row.");
      line("    Deriving would ZERO this order. Stored value may be the only record.");
    } else if (derived > Number(order.totalAmount ?? order.price) + 0.01) {
      line("    Completed transactions EXCEED the order total -> duplicate/renewal/legacy rows.");
      line("    Deriving would OVERSTATE this order.");
    } else if (pendingTx.length && Math.abs(invPaid - (derived + pendingTx.reduce((s,t)=>s+Number(t.amount||0),0))) < 0.01) {
      line("    Invoice counted a PENDING transaction as paid -> invoice is wrong, derived is right.");
    } else if (stored === 0 && derived > 0 && Math.abs(invPaid - derived) < 0.01) {
      line("    Invoice and transactions AGREE; only order.paidAmount was never written.");
      line("    Deriving CORRECTS this order.");
    } else if (completed.length && stored > derived) {
      line("    Stored is higher than real completed money -> stored was inflated by hand.");
    } else {
      line("    Needs manual eyes.");
    }
  }

  sep();
  await mongoose.disconnect();
  line("done (nothing was modified)");
};

main().catch(async (e) => {
  console.error("Forensics failed:", e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
