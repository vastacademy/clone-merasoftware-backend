const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const generateInvoiceNumber = require("./generateInvoiceNumber");

const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

// Invoice line items derived from an order's own orderItems snapshot, so the invoice mirrors
// exactly what the customer ordered (base + each feature). Shared SSOT — used by every path that
// creates a project invoice on demand (approveProjectOrder.js, walletPayInstant.js's due-based
// installment invoice creation, doc 52 Phase 3).
const buildLineItemsFromOrder = (order) => {
  if (Array.isArray(order?.orderItems) && order.orderItems.length > 0) {
    return order.orderItems.map((item) => ({
      name: item.name,
      price: Number(item.finalPrice ?? item.originalPrice ?? 0),
    }));
  }
  return [{ name: order?.productId?.serviceName || "Project", price: getOrderTotal(order) }];
};

// Shared payment-recording SSOT for admin-created / admin-approved custom projects.
//
// Extracted verbatim from adminCreateProjectOrder.js so the create-project flow and the
// project-approval flow record payment through the exact same logic (one transaction,
// one invoice, no duplicate systems).
//
// Deliberately NOT the recurring-plan markInvoicePaidAndResumePlan() helper
// (invoiceLifecycle.js), which is hardcoded to monthlyInvoiceModel and also runs
// plan-resume logic that does not apply to one-time / installment projects.

// Settles money against a project invoice (invoiceModel). This is the ONE shared place that
// changes an invoice's paid-state — status is always DERIVED from invoice.amountPaid vs
// invoice.amount, never hardcoded by a caller (SSOT — see doc 52).
//
//   - amount: how much is being applied NOW (defaults to the invoice's full amount, so existing
//     full-payment callers are unchanged). Pass a smaller amount for a partial/wallet-only part
//     of a combined wallet+UPI payment.
//   - existingTransaction: when the caller already created the completed transaction for this
//     money (e.g. deductWalletInstant's wallet debit), pass it here so this helper links it
//     instead of creating a second transaction for the same payment. Omit to have this helper
//     create the transaction itself (the original admin "Record Payment" / approval behaviour).
const markProjectInvoicePaid = async ({
  invoice,
  customerId,
  paymentMethod,
  transactionReference,
  notes,
  actorId,
  amount,
  existingTransaction = null,
}) => {
  const amountNow = Number(amount != null ? amount : invoice.amount);

  let transaction = existingTransaction;
  if (!transaction) {
    const transactionId = `INVPAID${String(invoice.invoiceNumber).replace(/[^a-zA-Z0-9]/g, "")}${Date.now()}`;
    transaction = await transactionModel.create({
      userId: customerId,
      orderId: invoice.orderId,
      invoiceId: invoice._id,
      transactionId,
      upiTransactionId: transactionReference || null,
      amount: amountNow,
      status: "completed",
      paymentStatus: "approved",
      type: "payment",
      sourceType: "invoice",
      description: `Payment recorded for invoice ${invoice.invoiceNumber}`,
      paymentMethod: paymentMethod || "cash",
      verifiedBy: actorId,
      verificationDate: new Date(),
      date: new Date(),
    });
  } else if (!transaction.invoiceId) {
    // Link a pre-existing transaction (e.g. a wallet debit) to this invoice if not linked yet.
    transaction.invoiceId = invoice._id;
    await transaction.save();
  }

  invoice.amountPaid = Math.min(
    Number(invoice.amount || 0),
    Number(invoice.amountPaid || 0) + amountNow
  );
  invoice.status =
    invoice.amountPaid >= Number(invoice.amount || 0)
      ? "paid"
      : invoice.amountPaid > 0
      ? "partially_paid"
      : "unpaid";
  if (invoice.status === "paid") {
    invoice.paidDate = new Date();
  }
  invoice.paymentMethod = paymentMethod || invoice.paymentMethod || "cash";
  invoice.transactionReference = transactionReference || invoice.transactionReference || null;
  invoice.markedPaidBy = actorId || invoice.markedPaidBy || null;
  if (notes) invoice.notes = notes;
  await invoice.save();

  return { invoice, transaction };
};

// Creates one project invoice on the shared invoiceModel (invoiceType: "project").
// Used both at create-time (adminCreateProjectOrder) and at approval-time for a
// Pay-Later order that was created without any invoice, so a single invoice model
// backs every project regardless of how it entered the system.
const createProjectInvoice = async ({
  customerId,
  orderId,
  amount,
  lineItems,
  installmentNumber,
  invoiceDate = new Date(),
  dueDate,
}) => {
  const invoiceNumber = await generateInvoiceNumber();
  return invoiceModel.create({
    userId: customerId,
    orderId,
    invoiceNumber,
    invoiceType: "project",
    amount,
    status: "unpaid",
    invoiceDate,
    dueDate: dueDate || invoiceDate,
    ...(installmentNumber ? { installmentNumber } : {}),
    lineItems,
  });
};

module.exports = {
  markProjectInvoicePaid,
  createProjectInvoice,
  buildLineItemsFromOrder,
};
