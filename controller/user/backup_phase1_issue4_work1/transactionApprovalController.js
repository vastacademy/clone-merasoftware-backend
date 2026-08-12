const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");
const orderProductModel = require("../../models/orderProductModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const { markInvoicePaidAndResumePlan } = require("../../helpers/invoiceLifecycle");

const requireAdmin = (req, res) => {
  if (req.userRole !== "admin") {
    res.status(403).json({
      message: "Forbidden",
      error: true,
      success: false,
    });
    return false;
  }

  return true;
};

const getTransactionIdFromRequest = (req) =>
  req.params.transactionId || req.body?.transactionId || req.query?.transactionId;

const getOrderTotal = (order) => Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

const isInvoiceTransaction = (transaction) =>
  transaction?.sourceType === "invoice" || Boolean(transaction?.invoiceId);

const isOrderPaymentTransaction = (transaction) =>
  ["order", "installment", "renewal", null, undefined].includes(transaction?.sourceType) &&
  Boolean(transaction?.orderId) &&
  transaction?.sourceType !== "invoice";

const applyApprovedOrderPayment = async (transaction) => {
  if (isInvoiceTransaction(transaction)) {
    if (!transaction.invoiceId) {
      return { order: null, invoice: null };
    }

    const paidResult = await markInvoicePaidAndResumePlan({
      invoiceId: transaction.invoiceId,
      paymentMethod: transaction.paymentMethod,
      transactionReference: transaction.upiTransactionId || transaction.transactionId,
      markedPaidBy: transaction.verifiedBy,
      transaction,
    });

    return {
      order: paidResult.order,
      invoice: paidResult.invoice,
      transaction: paidResult.transaction,
    };
  }

  if (!isOrderPaymentTransaction(transaction)) {
    return { order: null, invoice: null };
  }

  if (!transaction?.orderId) {
    return { order: null, invoice: null };
  }

  const order = await orderProductModel.findById(transaction.orderId).populate("productId");
  if (!order) {
    return { order: null, invoice: null };
  }

  const amount = Number(transaction.amount || 0);

  if (transaction.type === "renewal") {
    order.isActive = true;
    order.autoRenewalStatus = "active";
    await order.save();
    return { order, invoice: null };
  }

  if (transaction.installmentNumber && Array.isArray(order.installments) && order.installments.length > 0) {
    const installment = order.installments.find(
      (item) => Number(item.installmentNumber) === Number(transaction.installmentNumber)
    );

    if (installment && !installment.paid) {
      installment.paid = true;
      installment.paidDate = new Date();
      installment.paymentStatus = "none";
      installment.transactionId = transaction.transactionId;
      order.paidAmount = Number(order.paidAmount || 0) + amount;
    }
  } else {
    order.paidAmount = Number(order.paidAmount || 0) + amount;
  }

  const orderTotal = getOrderTotal(order);
  order.paidAmount = Math.min(Number(order.paidAmount || 0), orderTotal || Number(order.paidAmount || 0));
  order.remainingAmount = Math.max(0, orderTotal - Number(order.paidAmount || 0));

  const allInstallmentsPaid =
    Array.isArray(order.installments) &&
    order.installments.length > 0 &&
    order.installments.every((installment) => installment.paid);

  if (!order.isPartialPayment || order.remainingAmount <= 0 || allInstallmentsPaid) {
    order.paymentComplete = true;
  }

  const nextInstallment = Array.isArray(order.installments)
    ? order.installments.find((installment) => !installment.paid)
    : null;
  if (nextInstallment) {
    order.currentInstallment = nextInstallment.installmentNumber;
  }

  order.orderVisibility = "approved";
  if (order.status === "pending") {
    order.status = "in_progress";
  }
  order.rejectionReason = null;

  await order.save();
  return { order, invoice: null };
};

const rejectLinkedOrderPayment = async (transaction, rejectionReason) => {
  if (!isOrderPaymentTransaction(transaction)) return null;
  if (!transaction?.orderId) return null;

  const order = await orderProductModel.findById(transaction.orderId);
  if (!order) return null;

  if (transaction.installmentNumber && Array.isArray(order.installments)) {
    const installment = order.installments.find(
      (item) => Number(item.installmentNumber) === Number(transaction.installmentNumber)
    );
    if (installment && !installment.paid) {
      installment.paymentStatus = "rejected";
      installment.transactionId = transaction.transactionId;
    }
  }

  const hasPaidInstallment =
    Array.isArray(order.installments) && order.installments.some((installment) => installment.paid);

  if (!hasPaidInstallment && Number(order.paidAmount || 0) <= 0) {
    order.orderVisibility = "payment-rejected";
  }

  order.rejectionReason = rejectionReason || "Payment rejected by admin";
  await order.save();

  return order;
};

const approveTransaction = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const transactionId = getTransactionIdFromRequest(req);
    if (!transactionId) {
      return res.status(400).json({
        message: "transactionId is required",
        success: false,
        error: true,
      });
    }

    const transaction = await transactionModel.findOne({ transactionId });
    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
        success: false,
        error: true,
      });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({
        message: `Transaction is already ${transaction.status}`,
        success: false,
        error: true,
      });
    }

    const amount = Number(transaction.amount || 0);
    const user = await userModel.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({
        message: "Transaction user not found",
        success: false,
        error: true,
      });
    }

    if (transaction.paymentMethod === "wallet" && ["payment", "renewal"].includes(transaction.type)) {
      if (Number(user.walletBalance || 0) < amount) {
        return res.status(400).json({
          message: "Customer wallet balance is lower than the pending payment amount",
          success: false,
          error: true,
        });
      }
      user.walletBalance = Number(user.walletBalance || 0) - amount;
      await user.save();
    }

    if (transaction.type === "deposit") {
      user.walletBalance = Number(user.walletBalance || 0) + amount;
      await user.save();
    }

    transaction.status = "completed";
    transaction.paymentStatus = "approved";
    transaction.verifiedBy = req.userId;
    transaction.verificationDate = new Date();
    transaction.rejectionReason = null;
    transaction.rejectedAt = null;
    transaction.rejectedBy = null;
    await transaction.save();

    const linkedResult = await applyApprovedOrderPayment(transaction);

    const updatedTransaction = await transactionModel
      .findById(transaction._id)
      .populate("userId", "name email walletBalance")
      .populate("productId", "serviceName")
      .populate("verifiedBy", "name email");

    return res.status(200).json({
      message: "Transaction approved successfully",
      success: true,
      error: false,
      data: {
        transaction: updatedTransaction,
        order: linkedResult.order,
        invoice: linkedResult.invoice,
        walletBalance: user.walletBalance,
      },
    });
  } catch (error) {
    console.error("Error approving transaction:", error);
    return res.status(500).json({
      message: error.message || "Failed to approve transaction",
      success: false,
      error: true,
    });
  }
};

const rejectTransaction = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;

    const transactionId = getTransactionIdFromRequest(req);
    const rejectionReason = (req.body?.rejectionReason || "").trim();

    if (!transactionId) {
      return res.status(400).json({
        message: "transactionId is required",
        success: false,
        error: true,
      });
    }

    if (!rejectionReason) {
      return res.status(400).json({
        message: "Rejection reason is required",
        success: false,
        error: true,
      });
    }

    const transaction = await transactionModel.findOne({ transactionId });
    if (!transaction) {
      return res.status(404).json({
        message: "Transaction not found",
        success: false,
        error: true,
      });
    }

    if (transaction.status !== "pending") {
      return res.status(400).json({
        message: `Transaction is already ${transaction.status}`,
        success: false,
        error: true,
      });
    }

    transaction.status = "rejected";
    transaction.paymentStatus = "rejected";
    transaction.rejectionReason = rejectionReason;
    transaction.rejectedAt = new Date();
    transaction.rejectedBy = req.userId;
    transaction.verifiedBy = req.userId;
    transaction.verificationDate = new Date();
    await transaction.save();

    const order = await rejectLinkedOrderPayment(transaction, rejectionReason);

    const updatedTransaction = await transactionModel
      .findById(transaction._id)
      .populate("userId", "name email walletBalance")
      .populate("productId", "serviceName")
      .populate("verifiedBy", "name email")
      .populate("rejectedBy", "name email");

    return res.status(200).json({
      message: "Transaction rejected successfully",
      success: true,
      error: false,
      data: {
        transaction: updatedTransaction,
        order,
      },
    });
  } catch (error) {
    console.error("Error rejecting transaction:", error);
    return res.status(500).json({
      message: error.message || "Failed to reject transaction",
      success: false,
      error: true,
    });
  }
};

module.exports = {
  approveTransaction,
  rejectTransaction,
};
