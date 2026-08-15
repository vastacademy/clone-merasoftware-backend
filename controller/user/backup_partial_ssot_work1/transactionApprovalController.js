const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");
const orderProductModel = require("../../models/orderProductModel");
const invoiceModel = require("../../models/invoiceModel"); // project invoices (invoiceType:'project')
const { markInvoicePaidAndResumePlan } = require("../../helpers/invoiceLifecycle"); // monthlyInvoiceModel only
const { markProjectInvoicePaid } = require("../../helpers/paymentRecording");
// Refund helper — when a combined payment's UPI portion is rejected, its already-debited
// wallet portion must be returned to the customer.
const { refundWalletInstant } = require("../../helpers/transactionService");

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

// Applies an approved payment's money to an order — marks the installment paid (or advances
// paidAmount for a non-installment order), advances paidAmount/remainingAmount, and approves the
// order. Shared by the plain order-payment path AND the project-invoice path below (doc 52 Phase 5)
// so both settle an order's money through the exact same logic — no duplicated math.
const applyOrderMoneyForTransaction = async (order, transaction) => {
  const amount = Number(transaction.amount || 0);

  if (transaction.type === "renewal") {
    order.isActive = true;
    order.autoRenewalStatus = "active";
    await order.save();
    return order;
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
  return order;
};

const applyApprovedOrderPayment = async (transaction) => {
  if (isInvoiceTransaction(transaction)) {
    if (!transaction.invoiceId) {
      return { order: null, invoice: null };
    }

    // Two invoice models exist (doc 52 §2a) — look up the project invoice first (every project
    // order's invoice lives here); fall back to the legacy monthlyInvoiceModel (recurring plans).
    const projectInvoice = await invoiceModel.findById(transaction.invoiceId);

    if (projectInvoice) {
      const { invoice: settledInvoice } = await markProjectInvoicePaid({
        invoice: projectInvoice,
        customerId: transaction.userId,
        paymentMethod: transaction.paymentMethod,
        transactionReference: transaction.upiTransactionId || transaction.transactionId,
        actorId: transaction.verifiedBy,
        amount: Number(transaction.amount || 0),
        existingTransaction: transaction,
      });

      // A project invoice also has an order behind it — settle the order's money too (installment
      // paid / paidAmount / approval), through the SAME logic the plain order-payment path uses.
      let order = null;
      if (transaction.orderId) {
        order = await orderProductModel.findById(transaction.orderId).populate("productId");
        if (order) {
          order = await applyOrderMoneyForTransaction(order, transaction);
        }
      }

      return { order, invoice: settledInvoice, transaction };
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

  const updatedOrder = await applyOrderMoneyForTransaction(order, transaction);
  return { order: updatedOrder, invoice: null };
};

const rejectLinkedOrderPayment = async (transaction, rejectionReason) => {
  // A plain order-payment transaction rejects its order/installment directly below. A project
  // invoice transaction (invoiceId points at invoiceModel) also has an order behind it and needs
  // the same rejection (doc 52 Phase 5). A recurring-plan invoice transaction (invoiceId points at
  // monthlyInvoiceModel, or type 'renewal') has its OWN handling elsewhere — even though it also
  // carries an orderId, it must NOT fall through this order-payment logic (that would wrongly
  // touch installments a recurring plan doesn't have in the same shape).
  if (transaction?.type === "renewal") return null;
  if (!transaction?.orderId) return null;

  if (isInvoiceTransaction(transaction)) {
    const projectInvoice = await invoiceModel.exists({ _id: transaction.invoiceId });
    if (!projectInvoice) return null; // recurring-plan invoice — not handled here
  }

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

    // Combined payment: if this rejected UPI transaction had a paired wallet portion (same
    // parentTransactionId, already debited), refund that wallet amount to the customer.
    // refundWalletInstant is idempotent on its transactionId, so a retried rejection never
    // double-refunds.
    if (transaction.parentTransactionId) {
      const walletPortion = await transactionModel.findOne({
        parentTransactionId: transaction.parentTransactionId,
        paymentMethod: "wallet",
        type: "payment",
        status: "completed",
      });
      if (walletPortion) {
        await refundWalletInstant({
          userId: walletPortion.userId,
          transactionId: `${walletPortion.transactionId}-REFUND`,
          amount: walletPortion.amount,
          description: `Refund for rejected payment ${transaction.transactionId}`,
          parentTransactionId: transaction.parentTransactionId,
          orderId: walletPortion.orderId || null,
        });
      }
    }

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
