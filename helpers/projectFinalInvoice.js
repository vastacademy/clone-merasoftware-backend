const invoiceModel = require("../models/invoiceModel");
const generateInvoiceNumber = require("./generateInvoiceNumber");
const { buildLineItemsFromOrder } = require("./paymentRecording");

const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

// This is a statement, not another amount to collect. Its money fields mirror
// the already-settled order state after a successful payment transaction.
const syncProjectFinalInvoice = async (order) => {
  if (!order?.isWebsiteProject || !order?._id) return null;

  const amount = getOrderTotal(order);
  const amountPaid = Math.min(amount, Math.max(0, Number(order.paidAmount || 0)));
  const remainingAmount = Math.max(0, amount - amountPaid);
  const status = amountPaid >= amount ? "paid" : amountPaid > 0 ? "partially_paid" : "unpaid";
  const existing = await invoiceModel.findOne({ orderId: order._id, invoiceType: "project_final" });

  const payload = {
    amount,
    amountPaid,
    status,
    dueDate: order.createdAt || new Date(),
    lineItems: buildLineItemsFromOrder(order),
    notes: `Project payment summary. Outstanding balance: ${remainingAmount}.`,
  };

  if (status === "paid") payload.paidDate = existing?.paidDate || new Date();
  else payload.paidDate = null;

  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    return existing;
  }

  return invoiceModel.create({
    userId: order.userId,
    orderId: order._id,
    invoiceNumber: await generateInvoiceNumber(),
    invoiceType: "project_final",
    invoiceDate: new Date(),
    ...payload,
  });
};

module.exports = { syncProjectFinalInvoice };
