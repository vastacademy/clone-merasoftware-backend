const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");
const orderProductModel = require("../../models/orderProductModel");
const invoiceModel = require("../../models/invoiceModel"); // project invoices (invoiceType:'project')
const { markInvoicePaidAndResumePlan } = require("../../helpers/invoiceLifecycle"); // monthlyInvoiceModel only
const { markProjectInvoicePaid, reverseProjectInvoicePayment } = require("../../helpers/paymentRecording");
const { settleInstallmentInvoice } = require("../../helpers/installmentSettlement");
const { syncProjectFinalInvoice } = require("../../helpers/projectFinalInvoice");
const { settleServiceCycle } = require('../../helpers/serviceCycleSettlement');
const { syncServiceBillingStatement } = require('../../helpers/serviceBillingStatement');
// Refund helper — when a combined payment's UPI portion is rejected, its already-debited
// wallet portion must be returned to the customer.
const { refundWalletInstant } = require("../../helpers/transactionService");
const { markOrderApproved } = require("../../helpers/orderLifecycle");

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
//
// Partial-payment SSOT correction: a plain UPI installment transaction (sourceType:'installment',
// no invoiceId) used to settle the order's own fields here but never touched invoiceModel — only
// the wallet-instant route (walletPayInstant.js) settled the invoice. That left a UPI-paid
// installment's invoice `unpaid` forever, the same class of bug doc 52 fixed for the full-wallet
// case. This now calls the SAME settleInstallmentInvoice helper walletPayInstant.js uses, so every
// route settles an installment's invoice through identical logic — one settle path, not three.
//
// settleInvoice=false is passed by the invoice-mode caller (applyApprovedOrderPayment's
// isInvoiceTransaction branch), which already settled this exact invoice via markProjectInvoicePaid
// BEFORE calling this function (transaction.invoiceId case) — settling again here would be a
// second, redundant write against the same invoice for the same transaction.
const applyOrderMoneyForTransaction = async (order, transaction, { settleInvoice = true } = {}) => {
  const amount = Number(transaction.amount || 0);

  if (transaction.type === "renewal") {
    order.isActive = true;
    order.autoRenewalStatus = "active";
    await order.save();
    return order;
  }

  let settledInstallmentNumber = null;

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
      settledInstallmentNumber = installment.installmentNumber;
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

  // A cancelled order stays cancelled — approving a still-pending payment against it must
  // never resurrect it (see helpers/orderLifecycle.js).
  if (markOrderApproved(order)) {
    order.rejectionReason = null;
  }

  await order.save();

  // Settle the installment's own invoice — only for a fresh settlement (settledInstallmentNumber
  // is only set above when the installment was actually flipped from unpaid to paid just now, so
  // a duplicate/retried approval never re-settles an already-paid invoice), and only when the
  // caller hasn't already settled this transaction's invoice itself (settleInvoice=false).
  if (settleInvoice && settledInstallmentNumber != null) {
    await settleInstallmentInvoice({
      order,
      installmentNumber: settledInstallmentNumber,
      amount,
      paymentMethod: transaction.paymentMethod,
      transaction,
      customerId: transaction.userId,
      transactionReference: transaction.upiTransactionId || transaction.transactionId,
      actorId: transaction.verifiedBy,
    });
  }

  await syncProjectFinalInvoice(order);

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
      const outstanding = Math.max(0, Number(projectInvoice.amount || 0) - Number(projectInvoice.amountPaid || 0));
      if (Number(transaction.amount || 0) <= 0 || Number(transaction.amount || 0) > outstanding) {
        throw new Error("Transaction amount exceeds the invoice balance");
      }
      const { invoice: settledInvoice } = await markProjectInvoicePaid({
        invoice: projectInvoice,
        customerId: transaction.userId,
        paymentMethod: transaction.paymentMethod,
        transactionReference: transaction.upiTransactionId || transaction.transactionId,
        actorId: transaction.verifiedBy,
        amount: Number(transaction.amount || 0),
        existingTransaction: transaction,
      });

      const serviceOrder = await orderProductModel.findOne({
        _id: transaction.orderId || projectInvoice.orderId,
        isServicePlan: true,
      });
      // Both an initial service payment and a renewal payment settle a service
      // cycle. They must not go through project/installment accounting.
      if (serviceOrder) {
        const order = await settleServiceCycle({ orderId: serviceOrder._id, invoice: settledInvoice });
        return { order, invoice: settledInvoice, transaction };
      }

      // A project invoice also has an order behind it — settle the order's money too (installment
      // paid / paidAmount / approval), through the SAME logic the plain order-payment path uses.
      let order = null;
      if (transaction.orderId) {
        order = await orderProductModel.findById(transaction.orderId).populate("productId");
        if (order) {
          // This transaction's invoice (settledInvoice, above) is already settled — don't let
          // applyOrderMoneyForTransaction settle it again just because the transaction also
          // carries an installmentNumber.
          order = await applyOrderMoneyForTransaction(order, transaction, { settleInvoice: false });
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

// ---------------------------------------------------------------------------
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

// Rolls back the financial state previously advanced by an instant wallet portion. The paired UPI
// transaction was rejected, so that wallet money never became a valid payment for its invoice/order.
const reverseWalletPortionSettlement = async (walletPortion) => {
  const amount = Number(walletPortion?.amount || 0);
  if (!walletPortion?.orderId || !(amount > 0)) return null;

  if (walletPortion.invoiceId) {
    const invoice = await invoiceModel.findById(walletPortion.invoiceId);
    if (invoice) await reverseProjectInvoicePayment({ invoice, amount });
  }

  const order = await orderProductModel.findById(walletPortion.orderId);
  if (!order) return null;

  const orderTotal = getOrderTotal(order);
  order.paidAmount = Math.max(0, Number(order.paidAmount || 0) - amount);
  order.remainingAmount = Math.max(0, orderTotal - Number(order.paidAmount || 0));
  order.paymentComplete = order.remainingAmount <= 0;
  await order.save();

  if (order.isServicePlan) {
    await syncServiceBillingStatement(order);
  } else {
    await syncProjectFinalInvoice(order);
  }

  return order;
};

// Refund every wallet debit that hangs off a parent id. A combined payment has one; a batch
// has one per service. The financial rollback happens before its wallet credit, so the customer
// can never have refunded money while the invoice/order still shows it as paid.
const refundWalletPortionsFor = async (parentRef, rejectedRef) => {
  if (!parentRef) return;

  const walletPortions = await transactionModel.find({
    parentTransactionId: parentRef,
    paymentMethod: "wallet",
    type: "payment",
    status: "completed",
  });

  for (const walletPortion of walletPortions) {
    await reverseWalletPortionSettlement(walletPortion);
    await refundWalletInstant({
      userId: walletPortion.userId,
      transactionId: `${walletPortion.transactionId}-REFUND`,
      amount: walletPortion.amount,
      description: `Refund for rejected payment ${rejectedRef}`,
      parentTransactionId: parentRef,
      orderId: walletPortion.orderId || null,
    });
  }
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

    transaction.verifiedBy = req.userId;
    transaction.verificationDate = new Date();
    transaction.rejectionReason = null;
    transaction.rejectedAt = null;
    transaction.rejectedBy = null;

    // An approval settles three things — the invoice, the order, and this transaction's own
    // status. They must move together or not at all. Was: applyApprovedOrderPayment() ran first
    // and the transaction was only marked 'completed' afterwards, so anything that threw in
    // between (a real case: settleServiceCycle -> getCycleDates on a plan with no billing-cycle
    // length) left the invoice already marked PAID while the transaction stayed 'pending'. The
    // order was then unapprovable forever: retrying hit the invoice-balance guard, because the
    // invoice had no outstanding amount left to settle. Marking the transaction BEFORE applying
    // the money keeps every write inside one try — if applying throws, the catch below restores
    // the transaction to exactly the state it was read in, so a failed approval leaves nothing
    // half-written and can simply be retried once the underlying cause is fixed.
    // walletDelta records the balance change already applied above, so a failed apply can put
    // the customer's money back too — otherwise a throw would leave them debited for a payment
    // that never completed.
    const previousState = {
      status: transaction.status,
      paymentStatus: transaction.paymentStatus,
      walletDelta:
        transaction.paymentMethod === "wallet" && ["payment", "renewal"].includes(transaction.type)
          ? amount
          : transaction.type === "deposit"
          ? -amount
          : 0,
    };

    transaction.status = "completed";
    transaction.paymentStatus = "approved";
    await transaction.save();

    let linkedResult;
    try {
      linkedResult = await applyApprovedOrderPayment(transaction);
    } catch (applyError) {
      transaction.status = previousState.status;
      transaction.paymentStatus = previousState.paymentStatus;
      transaction.verifiedBy = null;
      transaction.verificationDate = null;
      await transaction.save();
      if (previousState.walletDelta) {
        await userModel.updateOne(
          { _id: transaction.userId },
          { $inc: { walletBalance: previousState.walletDelta } }
        );
      }
      throw applyError;
    }

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

    // Combined payment: refund the paired wallet portion that was already debited at purchase.
    // In every creation path (customerCreateServicePlanOrder.js,
    // customerCreateCustomProjectOrder.js, walletPayInstant.js) the UPI leg IS the parent — its
    // own transactionId is the shared id and its parentTransactionId is null — while the wallet
    // debit carries that id in parentTransactionId. Checking this transaction's own id as well
    // as its parent covers the link from either end; without the first, a rejected combined
    // payment silently kept the customer's wallet money.
    await refundWalletPortionsFor(transaction.transactionId, transaction.transactionId);
    await refundWalletPortionsFor(transaction.parentTransactionId, transaction.transactionId);

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
