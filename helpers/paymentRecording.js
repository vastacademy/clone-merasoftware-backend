const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const generateInvoiceNumber = require("./generateInvoiceNumber");

// Shared payment-recording SSOT for admin-created / admin-approved custom projects.
//
// Extracted verbatim from adminCreateProjectOrder.js so the create-project flow and the
// project-approval flow record payment through the exact same logic (one transaction,
// one invoice, no duplicate systems).
//
// Deliberately NOT the recurring-plan markInvoicePaidAndResumePlan() helper
// (invoiceLifecycle.js), which is hardcoded to monthlyInvoiceModel and also runs
// plan-resume logic that does not apply to one-time / installment projects.

const markProjectInvoicePaid = async ({
  invoice,
  customerId,
  paymentMethod,
  transactionReference,
  notes,
  actorId,
}) => {
  const transactionId = `INVPAID${String(invoice.invoiceNumber).replace(/[^a-zA-Z0-9]/g, "")}${Date.now()}`;

  const transaction = await transactionModel.create({
    userId: customerId,
    orderId: invoice.orderId,
    invoiceId: invoice._id,
    transactionId,
    upiTransactionId: transactionReference || null,
    amount: invoice.amount,
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

  invoice.status = "paid";
  invoice.paidDate = new Date();
  invoice.paymentMethod = paymentMethod || "cash";
  invoice.transactionReference = transactionReference || null;
  invoice.markedPaidBy = actorId;
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
};
