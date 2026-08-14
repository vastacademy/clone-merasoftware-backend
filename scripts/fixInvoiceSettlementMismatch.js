// Doc 52 Phase 7 — backup-first cleanup of invoice/payment data left broken by the bug fixed in
// Phases 1-6 (a wallet-instant payment settled the order but never marked its invoiceModel invoice
// paid). This script does NOT touch money (walletBalance/paidAmount) — it only makes each invoice's
// status/amountPaid match the COMPLETED transactions that already exist for its order, using the
// exact same status-derivation rule as markProjectInvoicePaid() (helpers/paymentRecording.js), so
// the fix is the SSOT rule applied retroactively, not a one-off patch.
//
// Modes:
//   node scripts/fixInvoiceSettlementMismatch.js            (default) DRY RUN — reports only, writes nothing.
//   node scripts/fixInvoiceSettlementMismatch.js --apply     Applies the fix to invoices with a
//                                                             clear, unambiguous mismatch.
//
// What it DOES fix (--apply): a project invoice whose status/amountPaid doesn't match the sum of
// COMPLETED transactions already recorded against its order for that installment (or the whole
// order, for a non-installment invoice) — e.g. the reported ₹15000 case (order 6a7efebd…):
// paidAmount=15000, one completed wallet transaction, invoice was 'unpaid'.
//
// What it does NOT touch (flags only, for manual review): orders with an invoice but ZERO
// completed transactions and no paidAmount (e.g. order 6a7ab6aa… — approved with paidAmount:0,
// 0 transactions — a pre-existing data defect unrelated to this bug; fixing money without knowing
// what really happened is not this script's job).
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const APPLY = process.argv.includes("--apply");

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(72));

// Same derivation rule as markProjectInvoicePaid() — kept identical on purpose (SSOT, doc 52).
const deriveStatus = (amountPaid, amount) =>
  amountPaid >= amount ? "paid" : amountPaid > 0 ? "partially_paid" : "unpaid";

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const invoices = await invoiceModel.find({ invoiceType: "project" });
  line(`\n=== Project invoices to check: ${invoices.length} ===`);

  let fixed = 0;
  let flagged = 0;
  let alreadyOk = 0;

  for (const invoice of invoices) {
    // Completed money actually recorded for this invoice's installment (or the whole order, for a
    // non-installment invoice) — the ground truth we settle the invoice against.
    const txnQuery = {
      orderId: invoice.orderId,
      status: "completed",
      type: { $in: ["payment"] },
    };
    if (invoice.installmentNumber != null) {
      txnQuery.installmentNumber = invoice.installmentNumber;
    } else {
      txnQuery.$or = [{ installmentNumber: null }, { installmentNumber: { $exists: false } }];
    }
    const completedTxns = await transactionModel.find(txnQuery);
    const trueAmountPaid = Math.min(
      Number(invoice.amount || 0),
      completedTxns.reduce((sum, t) => sum + Number(t.amount || 0), 0)
    );
    const trueStatus = deriveStatus(trueAmountPaid, Number(invoice.amount || 0));

    const currentAmountPaid = Number(invoice.amountPaid || 0);
    const currentStatus = invoice.status;

    if (currentStatus === trueStatus && currentAmountPaid === trueAmountPaid) {
      alreadyOk++;
      continue;
    }

    // Only a clear mismatch WITH evidence (completed transactions exist) is auto-fixed. An
    // invoice that's unpaid with zero completed transactions and the order shows no paid amount
    // is a different, unrelated data defect — flag it, don't guess at fixing money.
    const order = await orderProductModel.findById(invoice.orderId).select("orderVisibility paidAmount");
    const hasEvidence = completedTxns.length > 0;

    sep();
    line(`INVOICE ${invoice.invoiceNumber} (_id=${invoice._id})  order=${invoice.orderId}`);
    line(`  invoice.amount=${invoice.amount}  installmentNumber=${invoice.installmentNumber ?? "-"}`);
    line(`  current: status=${currentStatus}  amountPaid=${currentAmountPaid}`);
    line(`  derived from ${completedTxns.length} completed txn(s) (sum=${completedTxns.reduce((s, t) => s + Number(t.amount || 0), 0)}): status=${trueStatus}  amountPaid=${trueAmountPaid}`);
    line(`  order: orderVisibility=${order?.orderVisibility}  paidAmount=${order?.paidAmount}`);

    if (!hasEvidence) {
      line(`  -> FLAGGED for manual review (no completed transaction evidence — not auto-fixed).`);
      flagged++;
      continue;
    }

    if (APPLY) {
      invoice.amountPaid = trueAmountPaid;
      invoice.status = trueStatus;
      if (trueStatus === "paid" && !invoice.paidDate) invoice.paidDate = new Date();
      const linkedTxn = completedTxns[completedTxns.length - 1];
      if (linkedTxn) {
        invoice.paymentMethod = invoice.paymentMethod || linkedTxn.paymentMethod || null;
        invoice.transactionReference =
          invoice.transactionReference || linkedTxn.upiTransactionId || linkedTxn.transactionId || null;
      }
      await invoice.save();
      line(`  -> APPLIED.`);
      fixed++;
    } else {
      line(`  -> Would be FIXED (dry run — pass --apply to write this change).`);
      fixed++;
    }
  }

  sep();
  line(`\nSummary: ${alreadyOk} already correct, ${fixed} ${APPLY ? "fixed" : "would-fix"}, ${flagged} flagged for manual review.`);
  if (!APPLY && fixed > 0) {
    line("This was a DRY RUN — nothing was written. Re-run with --apply to write the fixes above.");
  }

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error("Script failed:", err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
