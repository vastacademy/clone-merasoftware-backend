const mongoose = require("mongoose");
const orderModel = require("../../models/orderProductModel");
const { deductWalletInstant } = require("../../helpers/transactionService");

// Instant wallet payment for an EXISTING order/installment — no admin approval.
//
// The wallet is the customer's own (already-approved) money, so spending it is instant. This
// is the shared, SSOT-safe replacement for the dead `/wallet/deduct` route that several pages
// called (InstallmentPayment.js, InvoiceDetailPage.js, and the customize flow). It:
//   1. atomically debits the wallet via deductWalletInstant() (guarded, records a completed txn)
//   2. applies that payment to the order exactly like transactionApprovalController does when it
//      approves a payment — marking the installment paid / advancing money + approving the order.
// If the wallet can't cover the amount it throws (caller then falls back to UPI for the rest).
//
// Two payment shapes are supported:
//   - Full settlement (amount covers the whole installment / due): wallet debit settles it, the
//     installment is marked paid and the order is approved immediately.
//   - Partial wallet + UPI remainder (a combined payment): the caller sends only the wallet part
//     here plus a `parentTransactionId`; this debits that part and advances `paidAmount` WITHOUT
//     marking the installment paid or approving the order. The UPI remainder is a separate pending
//     transaction (same parentTransactionId) that the admin approves later — that approval marks
//     the installment paid and flips the order to approved (transactionApprovalController), and its
//     `paidAmount += upiPart` adds onto the wallet part seeded here, so nothing double-counts. If
//     the UPI part is later rejected, the paired wallet part is auto-refunded (same controller).

const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

const walletPayInstant = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
        error: true,
        success: false,
      });
    }

    const { orderId, amount, installmentNumber, parentTransactionId } = req.body;

    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: "Valid orderId is required",
        error: true,
        success: false,
      });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        message: "A positive amount is required",
        error: true,
        success: false,
      });
    }

    // The order must belong to the caller — a customer can only spend their own wallet on
    // their own order.
    const order = await orderModel.findOne({ _id: orderId, userId });
    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    const isInstallment =
      installmentNumber != null &&
      Array.isArray(order.installments) &&
      order.installments.length > 0;

    // Debit the wallet atomically (throws if it can't cover the amount) + record a completed txn.
    const transactionId = `WPAY${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const { transaction, newBalance } = await deductWalletInstant({
      userId,
      transactionId,
      amount: numericAmount,
      orderId: order._id,
      installmentNumber: isInstallment ? installmentNumber : null,
      isInstallmentPayment: isInstallment,
      description: `${
        isInstallment ? `Installment ${installmentNumber}` : "Payment"
      } (wallet) for order ${order._id}`,
    });

    // Apply the payment to the order — same math as transactionApprovalController's approval.
    if (isInstallment) {
      const installment = order.installments.find(
        (item) => Number(item.installmentNumber) === Number(installmentNumber)
      );
      if (installment && !installment.paid) {
        installment.paid = true;
        installment.paidDate = new Date();
        installment.paymentStatus = "none";
        installment.transactionId = transaction.transactionId;
        order.paidAmount = Number(order.paidAmount || 0) + numericAmount;
      }
    } else {
      order.paidAmount = Number(order.paidAmount || 0) + numericAmount;
    }

    const orderTotal = getOrderTotal(order);
    order.paidAmount = Math.min(
      Number(order.paidAmount || 0),
      orderTotal || Number(order.paidAmount || 0)
    );
    order.remainingAmount = Math.max(0, orderTotal - Number(order.paidAmount || 0));

    const allInstallmentsPaid =
      Array.isArray(order.installments) &&
      order.installments.length > 0 &&
      order.installments.every((item) => item.paid);

    if (!order.isPartialPayment || order.remainingAmount <= 0 || allInstallmentsPaid) {
      order.paymentComplete = true;
    }

    const nextInstallment = Array.isArray(order.installments)
      ? order.installments.find((item) => !item.paid)
      : null;
    if (nextInstallment) {
      order.currentInstallment = nextInstallment.installmentNumber;
    }

    order.orderVisibility = "approved";
    if (order.status === "pending") order.status = "in_progress";
    order.rejectionReason = null;

    await order.save();

    return res.status(200).json({
      message: "Wallet payment successful",
      success: true,
      error: false,
      data: {
        transactionId: transaction.transactionId,
        amount: numericAmount,
        walletBalance: newBalance,
        remainingAmount: order.remainingAmount,
        paymentComplete: order.paymentComplete,
      },
    });
  } catch (error) {
    console.error("Error in wallet instant payment:", error);
    const message = error.message || "Wallet payment failed";
    // Insufficient balance is a client error, not a server fault.
    const status = message.includes("Insufficient") ? 400 : 500;
    return res.status(status).json({
      message,
      error: true,
      success: false,
    });
  }
};

module.exports = walletPayInstant;
