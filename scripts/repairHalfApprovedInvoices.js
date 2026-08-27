// Repairs invoices left half-settled by the pre-fix approval bug.
//
// Background: approveTransaction() used to settle the invoice BEFORE marking the transaction
// 'completed'. When settleServiceCycle() threw in between (a plan with no billing-cycle length),
// the invoice stayed marked PAID while its transaction stayed 'pending' — money that was never
// actually approved. The order could then never be approved, because the retry saw an invoice
// with no outstanding balance left.
//
// This script restores the invariant: an invoice's amountPaid counts ONLY completed
// transactions. Pending money is removed, and status is re-derived (never hardcoded), exactly
// the way markProjectInvoicePaid() derives it.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairHalfApprovedInvoices.js
//   node scripts/repairHalfApprovedInvoices.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const money = (v) => Number(Number(v || 0).toFixed(2));

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { line("No Mongo URI in .env"); process.exit(1); }
  await mongoose.connect(uri);
  line(APPLY ? "MODE: APPLY (will write)" : "MODE: DRY-RUN (no writes)");
  line("");

  // Scope: ONLY invoices left inconsistent by the half-approval bug — i.e. an invoice that has
  // a still-'pending' transaction pointing at it, yet was already credited for that pending
  // money. Every other invoice is deliberately untouched: most historical payments predate the
  // invoiceId link on transactions (they are joined by orderId instead), so treating a missing
  // invoiceId match as "never paid" would wrongly reset genuinely paid invoices to unpaid.
  const pendingTxns = await transactionModel.find({ status: "pending", invoiceId: { $ne: null } }).lean();
  const candidateIds = [...new Set(pendingTxns.map((t) => String(t.invoiceId)))];
  const invoices = await invoiceModel.find({ _id: { $in: candidateIds }, amountPaid: { $gt: 0 } }).lean();
  let repaired = 0;

  for (const invoice of invoices) {
    // What this invoice has genuinely received = its completed transactions only.
    const txns = await transactionModel.find({ invoiceId: invoice._id }).lean();
    const truePaid = txns.reduce((total, t) => {
      if (t.status !== "completed") return total;
      if (t.type === "refund") return total - Number(t.amount || 0);
      return total + Number(t.amount || 0);
    }, 0);

    const storedPaid = Number(invoice.amountPaid || 0);
    if (Math.abs(truePaid - storedPaid) <= 0.01) continue;

    // Same derivation rule as markProjectInvoicePaid() — status follows the money.
    const amount = Number(invoice.amount || 0);
    const trueStatus = truePaid >= amount ? "paid" : truePaid > 0 ? "partially_paid" : "unpaid";

    repaired += 1;
    line(`${invoice.invoiceNumber || invoice._id}`);
    line(`  stored : amountPaid=${money(storedPaid)}  status=${invoice.status}`);
    line(`  true   : amountPaid=${money(truePaid)}  status=${trueStatus}   (from ${txns.filter(t => t.status === "completed").length} completed txn)`);

    if (APPLY) {
      await invoiceModel.updateOne(
        { _id: invoice._id },
        {
          $set: {
            amountPaid: truePaid,
            status: trueStatus,
            ...(trueStatus === "paid" ? {} : { paidDate: null }),
          },
        }
      );
      line("  -> repaired");
    }
    line("");
  }

  line(repaired === 0 ? "Nothing to repair — every invoice already matches its completed transactions."
                      : `${repaired} invoice(s) ${APPLY ? "repaired" : "would be repaired (re-run with --apply)"}.`);
  await mongoose.disconnect();
};

main().catch(async (e) => {
  console.error("Repair failed:", e);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
