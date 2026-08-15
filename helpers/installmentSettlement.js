const invoiceModel = require("../models/invoiceModel");
const {
  markProjectInvoicePaid,
  createProjectInvoice,
  buildLineItemsFromOrder,
} = require("./paymentRecording");

// Shared installment-invoice settlement SSOT.
//
// An installment's money can arrive through more than one route (instant wallet debit, or an
// admin-approved UPI transaction). Each route used to settle the order's own fields correctly but
// only the wallet route also settled the INVOICE — so an installment paid by UPI left its invoice
// `unpaid` forever, exactly the class of bug doc 52 fixed for the full-wallet case. This helper is
// that one settle path, extracted verbatim from walletPayInstant.js so every route now settles
// through identical logic.
//
// Due-based invoicing (doc 52 Phase 3): installment #1's invoice already exists from order
// creation, but #2/#3 only get theirs when they actually become due — i.e. when they are being
// paid. Find-or-create (never a duplicate for the same installment), then settle by exactly the
// amount received, reusing the SAME transaction (no second transaction — doc 52 Q1).
//
// Status is never hardcoded here: markProjectInvoicePaid derives it from amountPaid vs amount, so
// a wallet part alone lands on `partially_paid` and the later approved UPI part completes it to
// `paid` — the accumulation (`amountPaid += amountNow`) is what makes a combined wallet+UPI
// installment payment settle correctly without ever double-counting.

const settleInstallmentInvoice = async ({
  order,
  installmentNumber,
  amount,
  paymentMethod,
  transaction,
  customerId,
  transactionReference = null,
  actorId = null,
}) => {
  if (!order || installmentNumber == null) return null;

  const targetInstallment = Array.isArray(order.installments)
    ? order.installments.find(
        (item) => Number(item.installmentNumber) === Number(installmentNumber)
      )
    : null;

  let installmentInvoice = await invoiceModel.findOne({
    orderId: order._id,
    installmentNumber,
  });

  if (!installmentInvoice) {
    installmentInvoice = await createProjectInvoice({
      customerId,
      orderId: order._id,
      amount: Number(targetInstallment?.amount || amount),
      lineItems: buildLineItemsFromOrder(order),
      installmentNumber,
      dueDate: targetInstallment?.dueDate || new Date(),
    });
  }

  const { invoice: settledInvoice } = await markProjectInvoicePaid({
    invoice: installmentInvoice,
    customerId,
    paymentMethod,
    amount,
    existingTransaction: transaction,
    transactionReference,
    actorId,
  });

  return settledInvoice;
};

module.exports = { settleInstallmentInvoice };
