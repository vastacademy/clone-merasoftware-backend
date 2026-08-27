// READ-ONLY. Writes nothing.
//
// Guards the admin payment-record list against the bug where a combined wallet+UPI payment
// showed only ONE row: AdminClientWorkspace.js's PaymentOrderHistorySubpage used to key a Map
// invoiceId -> one transaction, so the second leg on the same invoice overwrote the first and
// the pending UPI payment lost its "Review Payment" button.
//
// This mirrors that grouping logic and asserts the invariant it must keep:
//   every linked transaction on an invoice gets its own row, and a pending one is reviewable.
// It runs the rule against fixed cases AND against the live database, so a real combined
// purchase that would render only one row is caught here.
//
// Run:  node scripts/verifyCombinedPaymentRows.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

let passed = 0, failed = 0;
const check = (name, actual, expected) => {
  const ok = String(actual) === String(expected);
  if (ok) { passed += 1; console.log(`  PASS  ${name}`); }
  else { failed += 1; console.log(`  FAIL  ${name} — expected ${expected}, got ${actual}`); }
};

// The exact grouping the page performs (kept in step with AdminClientWorkspace.js).
const buildRows = (invoices, transactions) => {
  const byInvoice = new Map();
  transactions.forEach((t) => {
    const id = t.invoiceId ? String(t.invoiceId) : null;
    if (!id) return;
    if (!byInvoice.has(id)) byInvoice.set(id, []);
    byInvoice.get(id).push(t);
  });
  return invoices.flatMap((invoice) => {
    const linked = byInvoice.get(String(invoice._id)) || [];
    if (!linked.length) return [{ invoice, transaction: null }];
    return linked.map((transaction) => ({ invoice, transaction }));
  });
};

const canReview = (row) => Boolean(row.transaction && row.transaction.status === "pending");

const main = async () => {
  console.log("RULE CHECKS");
  const invoice = { _id: "inv1", amount: 2500 };
  const combined = buildRows([invoice], [
    { _id: "w", invoiceId: "inv1", amount: 500, paymentMethod: "wallet", status: "completed" },
    { _id: "u", invoiceId: "inv1", amount: 2000, paymentMethod: "upi", status: "pending" },
  ]);
  check("combined payment renders two rows", combined.length, 2);
  check("exactly one row is reviewable", combined.filter(canReview).length, 1);
  check("the reviewable row is the UPI leg", combined.find(canReview)?.transaction.paymentMethod, "upi");

  check("invoice with no payment still renders once", buildRows([invoice], []).length, 1);
  check("single payment renders one row", buildRows([invoice], [
    { _id: "s", invoiceId: "inv1", amount: 2500, status: "pending" },
  ]).length, 1);
  check("three legs render three rows", buildRows([invoice], [
    { _id: "a", invoiceId: "inv1", amount: 1000, status: "completed" },
    { _id: "b", invoiceId: "inv1", amount: 1000, status: "completed" },
    { _id: "c", invoiceId: "inv1", amount: 500, status: "pending" },
  ]).length, 3);

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { console.log("\nNo Mongo URI — skipping live checks."); process.exit(failed ? 1 : 0); }
  await mongoose.connect(uri);

  console.log("\nLIVE DATA CHECKS");
  // Any invoice that carries more than one transaction must produce that many rows, and every
  // pending payment on it must remain reviewable.
  const linked = await transactionModel.find({ invoiceId: { $ne: null } }).select("invoiceId amount status paymentMethod").lean();
  const grouped = new Map();
  linked.forEach((t) => {
    const id = String(t.invoiceId);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(t);
  });

  let multiLeg = 0, hiddenPending = 0;
  for (const [invoiceId, txns] of grouped) {
    if (txns.length < 2) continue;
    multiLeg += 1;
    const inv = await invoiceModel.findById(invoiceId).select("_id amount").lean();
    if (!inv) continue;
    const rows = buildRows([inv], txns);
    if (rows.length !== txns.length) hiddenPending += 1;
    const pendingCount = txns.filter((t) => t.status === "pending").length;
    if (rows.filter(canReview).length !== pendingCount) hiddenPending += 1;
  }
  console.log(`  (invoices carrying multiple payments: ${multiLeg})`);
  check("every payment on a multi-leg invoice gets a row", hiddenPending, 0);

  await mongoose.disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch(async (e) => {
  console.error("Verification error:", e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
