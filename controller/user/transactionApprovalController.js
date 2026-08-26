const transactionModel = require("../../models/transactionModel");
const paymentBatchModel = require("../../models/paymentBatchModel");
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

  order.orderVisibility = "approved";
  if (order.status === "pending") {
    order.status = "in_progress";
  }
  order.rejectionReason = null;

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
// Batch child settlement (one payment covering several orders)
//
// Several service plans can be bought in one go against a single UPI payment
// (customerCreateServicePlanOrdersBulk.js). transactionModel.orderId/.invoiceId are single
// refs — one transaction settles one order — so that purchase is recorded as:
//
//   BATCH (paymentBatchModel) — the approval group the admin acts on. Not a transaction:
//              it has no orderId of its own because it covers many.
//   CHILDREN — one transaction per service, each with its own orderId/invoiceId and
//              carrying parentTransactionId = the batch's batchRef.
//
// The batch is resolved by settling each child through EXACTLY the same single-order code
// path (applyApprovedOrderPayment / rejectLinkedOrderPayment) that handles every other
// payment. Nothing about that logic changes — it is simply called once per child.
//
// These helpers are only reached from the batch paths. A plain combined payment's paired
// wallet debit also carries parentTransactionId, but it is already completed at purchase
// time and is filtered out below, so it is never re-settled here.
// ---------------------------------------------------------------------------

// True when this transaction belongs to a payment batch. A batch is all-or-nothing, so its
// children are settled only through the batch, never individually. A plain combined payment
// also carries parentTransactionId, but no batch exists for it, so it is unaffected.
const isBatchChild = async (transaction) => {
  if (!transaction?.parentTransactionId) return false;
  return Boolean(await paymentBatchModel.exists({ batchRef: transaction.parentTransactionId }));
};

// Accepts anything carrying the shared parent id: a transaction (combined-payment parent)
// via .transactionId, or a payment batch via .batchRef — both hold the exact same value
// that children store in parentTransactionId.
const findChildTransactions = async (parent) => {
  const parentRef = parent?.transactionId || parent?.batchRef;
  if (!parentRef) return [];
  return transactionModel.find({
    parentTransactionId: parentRef,
    // The paired wallet debit of a combined payment is already completed and settled
    // at purchase time — only the pending UPI children are settled on approval.
    status: "pending",
    paymentMethod: { $ne: "wallet" },
  });
};

const settleChildTransactions = async (parentTransaction, adminId) => {
  const children = await findChildTransactions(parentTransaction);
  if (!children.length) return null;

  const settledOrders = [];
  for (const child of children) {
    child.verifiedBy = adminId;
    child.verificationDate = new Date();
    child.rejectionReason = null;
    child.rejectedAt = null;
    child.rejectedBy = null;
    // Same single-order settlement used by every other approved payment.
    const result = await applyApprovedOrderPayment(child);
    child.status = "completed";
    child.paymentStatus = "approved";
    await child.save();
    if (result?.order) settledOrders.push(result.order);
  }

  return { childCount: children.length, orders: settledOrders };
};

const rejectChildTransactions = async (parentTransaction, rejectionReason, adminId) => {
  const children = await findChildTransactions(parentTransaction);
  if (!children.length) return null;

  const rejectedOrders = [];
  for (const child of children) {
    child.status = "rejected";
    child.paymentStatus = "rejected";
    child.rejectionReason = rejectionReason;
    child.rejectedAt = new Date();
    child.rejectedBy = adminId;
    child.verifiedBy = adminId;
    child.verificationDate = new Date();
    await child.save();

    const order = await rejectLinkedOrderPayment(child, rejectionReason);
    if (order) rejectedOrders.push(order);
  }

  return { childCount: children.length, orders: rejectedOrders };
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

// ---------------------------------------------------------------------------
// Payment batches (paymentBatchModel): one payment covering several orders.
//
// The batch is the approval group, not a payment — the real money lives in its child
// transactions, one per order. Approving/rejecting a batch resolves those children through
// the SAME single-order path every other payment uses; nothing in that logic changes.
// ---------------------------------------------------------------------------

const approvePaymentBatch = async (batch, req, res) => {
  if (batch.status !== "pending-approval") {
    return res.status(400).json({
      message: `Payment is already ${batch.status === "approved" ? "approved" : "rejected"}`,
      success: false,
      error: true,
    });
  }

  const childResult = await settleChildTransactions(batch, req.userId);
  const childCount = childResult ? childResult.childCount : 0;

  batch.status = "approved";
  batch.verifiedBy = req.userId;
  batch.verificationDate = new Date();
  batch.rejectionReason = null;
  batch.rejectedAt = null;
  batch.rejectedBy = null;
  await batch.save();

  return res.status(200).json({
    message: `Payment approved — ${childCount} service${childCount === 1 ? "" : "s"} activated`,
    success: true,
    error: false,
    data: {
      paymentBatch: batch,
      order: childResult?.orders?.[0] || null,
      invoice: null,
      childOrders: childResult ? childResult.orders : [],
    },
  });
};

const rejectPaymentBatch = async (batch, rejectionReason, req, res) => {
  if (batch.status !== "pending-approval") {
    return res.status(400).json({
      message: `Payment is already ${batch.status === "approved" ? "approved" : "rejected"}`,
      success: false,
      error: true,
    });
  }

  // A batch's wallet debits hang off its own batchRef (children carry it as parentTransactionId).
  await refundWalletPortionsFor(batch.batchRef, batch.batchRef);

  batch.status = "rejected";
  batch.rejectionReason = rejectionReason;
  batch.rejectedAt = new Date();
  batch.rejectedBy = req.userId;
  batch.verifiedBy = req.userId;
  batch.verificationDate = new Date();
  await batch.save();

  const childResult = await rejectChildTransactions(batch, rejectionReason, req.userId);

  return res.status(200).json({
    message: "Payment rejected successfully",
    success: true,
    error: false,
    data: {
      paymentBatch: batch,
      order: childResult?.orders?.[0] || null,
      childOrders: childResult ? childResult.orders : [],
    },
  });
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
      // Not a transaction — it may be a payment batch (one payment, several orders).
      const batch = await paymentBatchModel.findOne({ batchRef: transactionId });
      if (batch) return approvePaymentBatch(batch, req, res);

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

    // A batch's child must never be settled on its own — the batch is all-or-nothing, and
    // approving one child would leave the batch (and its siblings) stranded. Approve the batch.
    if (await isBatchChild(transaction)) {
      return res.status(400).json({
        message: "This payment is part of a multi-service payment. Approve the payment itself, not one service.",
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
    const linkedResult = await applyApprovedOrderPayment(transaction);

    transaction.status = "completed";
    transaction.paymentStatus = "approved";
    await transaction.save();

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
      // Not a transaction — it may be a payment batch (one payment, several orders).
      const batch = await paymentBatchModel.findOne({ batchRef: transactionId });
      if (batch) return rejectPaymentBatch(batch, rejectionReason, req, res);

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

    // Same all-or-nothing rule as approval — a batch's child is rejected via the batch.
    if (await isBatchChild(transaction)) {
      return res.status(400).json({
        message: "This payment is part of a multi-service payment. Reject the payment itself, not one service.",
        success: false,
        error: true,
      });
    }

    // Combined payment: refund the paired wallet portion that was already debited at purchase.
    // The wallet debit stores the UPI transaction's id in its parentTransactionId, and the two
    // creation paths write that link from opposite ends:
    //   - customerCreateServicePlanOrder.js / customerCreateCustomProjectOrder.js: the UPI leg
    //     IS the parent (its own transactionId is the shared id; its parentTransactionId is null).
    //   - a batch child: the shared id lives in its parentTransactionId.
    // Checking this transaction's own id as well as its parent covers both — without it, the
    // first shape never matched and a rejected combined payment silently kept the customer's
    // wallet money.
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
