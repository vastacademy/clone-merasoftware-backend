const transactionModel = require("../models/transactionModel");

// SINGLE SOURCE OF TRUTH for "how much money has this order actually received".
//
// Before this helper, that number was maintained by hand in nine different places
// (order creation, wallet-instant pay, approval, rejection, service-cycle settlement, …),
// each doing its own `+=` / `-=` / clamp. Any code path that threw halfway through left
// order.paidAmount and invoice.amountPaid disagreeing with the transactions that are the
// real record of money — which is exactly how a service order ended up with a PAID invoice
// and a still-PENDING payment, unapprovable forever.
//
// The rule, verified against the live data:
//   - Only `completed` transactions count. `pending` money has not arrived — a pending
//     payment must never make an invoice look settled.
//   - `refund` subtracts (a reversed payment is money given back).
//   - `deposit` never counts: it is a wallet recharge, not order money. Confirmed in data —
//     all 15 deposits carry orderId: null.
//   - `renewal` never counts toward the ORDER total: it is recurring money for a later
//     billing cycle, not payment of the order's own price. Confirmed in data — 15 renewal
//     transactions sit on one plan order whose price is a fraction of their sum, so counting
//     them would report that order as massively overpaid. Renewals are tracked per cycle by
//     serviceCycleSettlement.js / the invoice they settle, not by the order's paidAmount.
//
// Everything else (`payment`, whatever the payment method) is money against the order.

const COUNTED_TYPES = new Set(["payment"]);

// Sums an already-loaded list of transactions. Kept separate so callers that have the
// transactions in hand (or a session-bound read) never need a second query.
const sumReceivedFromTransactions = (transactions = []) =>
  transactions.reduce((total, transaction) => {
    if (transaction?.status !== "completed") return total;
    const amount = Number(transaction.amount || 0);
    if (transaction.type === "refund") return total - amount;
    if (!COUNTED_TYPES.has(transaction.type)) return total;
    return total + amount;
  }, 0);

// How much of this order's own price has actually been received.
const getOrderAmountReceived = async (orderId, { session = null } = {}) => {
  if (!orderId) return 0;
  const query = transactionModel.find({ orderId }).select("amount status type").lean();
  if (session) query.session(session);
  return sumReceivedFromTransactions(await query);
};

// How much has actually been received against ONE invoice. Used where an order carries
// several payable invoices (installments, service cycles) and each must settle on its own
// money rather than the order's running total.
const getInvoiceAmountReceived = async (invoiceId, { session = null } = {}) => {
  if (!invoiceId) return 0;
  const query = transactionModel.find({ invoiceId }).select("amount status type").lean();
  if (session) query.session(session);
  return sumReceivedFromTransactions(await query);
};

// Derives an invoice's status from its money — never hardcoded. Same rule
// markProjectInvoicePaid() already applies, exposed here so every caller derives it
// identically instead of re-implementing the comparison.
const deriveInvoiceStatus = (amountPaid, amount) => {
  const paid = Number(amountPaid || 0);
  const total = Number(amount || 0);
  if (paid >= total && total > 0) return "paid";
  return paid > 0 ? "partially_paid" : "unpaid";
};

module.exports = {
  sumReceivedFromTransactions,
  getOrderAmountReceived,
  getInvoiceAmountReceived,
  deriveInvoiceStatus,
};
