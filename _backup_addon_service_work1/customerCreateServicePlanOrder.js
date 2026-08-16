const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
// SSOT: every paid order gets an invoice through the same shared helper used by
// the project paths — a service plan is money owed exactly like a project is.
const { createProjectInvoice, markProjectInvoicePaid } = require("../../helpers/paymentRecording");
// Shared transaction-creation SSOT. Wallet is the customer's own money so it is
// debited instantly; any UPI remainder is a pending transaction admin approves.
const {
  createPaymentTransaction,
  deductWalletInstant,
} = require("../../helpers/transactionService");

// Customer-side purchase path for Service Plan products (category "service_plan").
// Modelled directly on customerCreateCustomProjectOrder.js — same payment/approval
// chain, same invoice SSOT — but a service plan has no project timeline, no
// installments and no features. Instead it starts a validity window and its first
// service cycle at purchase time.
//
// A service plan can be bought two ways, and this one controller serves both:
//   standalone            -> linkedProjectOrderId omitted
//   add-on to a project   -> linkedProjectOrderId + addedDuringProjectPhase sent
// The linkage is stored as reference/reporting data; it does not branch any logic.

const SERVICE_PLAN_CATEGORY = "service_plan";

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

// Cycle length in days per billing cycle. A plan with no billing cycle bills once
// up front, so its "cycle" is simply the whole validity window.
const BILLING_CYCLE_DAYS = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  yearly: 365,
  every_2_years: 730,
  every_3_years: 1095,
  every_4_years: 1460,
  every_5_years: 1825,
};

const PROJECT_PHASES = ["in_progress", "after_completion"];

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const customerCreateServicePlanOrder = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({
        message: "Authentication required",
        error: true,
        success: false,
      });
    }

    const {
      planId,
      linkedProjectOrderId,
      addedDuringProjectPhase,
      paymentDetails,
    } = req.body;

    if (!planId) {
      return res.status(400).json({
        message: "A plan is required",
        error: true,
        success: false,
      });
    }

    // The plan template is re-read from the DB — price and config are never
    // trusted from the client (same rule as every other order path here).
    const plan = await productModel.findById(planId);

    if (!plan || plan.category !== SERVICE_PLAN_CATEGORY || !plan.isServicePlan) {
      return res.status(400).json({
        message: "This plan is not available",
        error: true,
        success: false,
      });
    }

    if (plan.isHidden) {
      return res.status(400).json({
        message: "This plan is not available for purchase",
        error: true,
        success: false,
      });
    }

    const servicePlan = plan.servicePlan || {};

    const finalPrice = Number(
      plan.sellingPrice !== undefined && plan.sellingPrice !== null
        ? plan.sellingPrice
        : plan.price
    );

    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({
        message: "Could not determine a price for this plan. Please contact support.",
        error: true,
        success: false,
      });
    }

    // ----- Add-on linkage (optional). Verified, never trusted: the linked project
    // must exist AND belong to this same customer, so one customer can never
    // attach a service to another customer's project. -----
    let linkedOrder = null;
    if (linkedProjectOrderId) {
      linkedOrder = await orderModel.findOne({ _id: linkedProjectOrderId, userId });
      if (!linkedOrder) {
        return res.status(400).json({
          message: "The project this service is being added to was not found",
          error: true,
          success: false,
        });
      }
      if (addedDuringProjectPhase && !PROJECT_PHASES.includes(addedDuringProjectPhase)) {
        return res.status(400).json({
          message: "Invalid project phase",
          error: true,
          success: false,
        });
      }
    }

    // The phase is re-derived server-side from the project's real progress rather
    // than trusting the client's value — the client's is only a hint from the UI.
    const resolvedPhase = linkedOrder
      ? (linkedOrder.projectProgress >= 100 || linkedOrder.currentPhase === "completed"
          ? "after_completion"
          : "in_progress")
      : null;

    // ----- Validity + first cycle window -----
    const validityInDays =
      Number(servicePlan.validityInDays) ||
      Number(servicePlan.validityValue || 0) * (VALIDITY_UNIT_DAYS[servicePlan.validityUnit] || 0);

    if (!Number.isFinite(validityInDays) || validityInDays <= 0) {
      return res.status(400).json({
        message: "This plan has no valid duration configured. Please contact support.",
        error: true,
        success: false,
      });
    }

    const startDate = new Date();
    const endDate = addDays(startDate, validityInDays);

    // A plan billed on a cycle runs in repeating windows; one with no billing
    // cycle is a single up-front purchase, so its first cycle is the full term.
    const cycleDays = BILLING_CYCLE_DAYS[servicePlan.billingCycle] || validityInDays;
    const firstCycleEnd = addDays(startDate, Math.min(cycleDays, validityInDays));

    // Frozen copy of the plan's config at purchase time, so a later admin edit to
    // the template never silently changes what this customer already bought.
    const servicePlanSnapshot = {
      planType: servicePlan.planType,
      serviceBehavior: servicePlan.serviceBehavior,
      limitScope: servicePlan.limitScope,
      manualUnit: servicePlan.manualUnit,
      manualCount: servicePlan.manualCount,
      portalAccessCount: servicePlan.portalAccessCount,
      filesLimit: servicePlan.filesLimit,
      validityUnit: servicePlan.validityUnit,
      validityValue: servicePlan.validityValue,
      validityInDays,
      billingCycle: servicePlan.billingCycle,
    };

    const orderData = {
      userId,
      productId: plan._id,
      quantity: 1,
      price: finalPrice,
      originalPrice: finalPrice,
      totalAmount: finalPrice,
      // Customer-initiated => admin approval, same as every other customer order.
      orderVisibility: "pending-approval",
      // A service plan is not a project: no timeline, no nodes, no installments.
      isWebsiteProject: false,
      isPartialPayment: false,
      paidAmount: 0,
      remainingAmount: finalPrice,
      paymentComplete: false,
      messages: [],
      orderItems: [
        {
          id: plan._id.toString(),
          name: plan.serviceName,
          type: "main",
          quantity: 1,
          originalPrice: finalPrice,
          finalPrice,
        },
      ],

      // Service Plan tracking
      isServicePlan: true,
      servicePlanSnapshot,
      servicePlanStartDate: startDate,
      servicePlanEndDate: endDate,
      serviceCurrentCycleNumber: 1,
      serviceCurrentCycleStart: startDate,
      serviceCurrentCycleEnd: firstCycleEnd,
      serviceAccessUsedInCycle: 0,
      serviceAccessUsedTotal: 0,
      servicePlanStatus: "active",

      // Add-on linkage (null for a standalone purchase)
      linkedProjectOrderId: linkedOrder ? linkedOrder._id : null,
      addedDuringProjectPhase: resolvedPhase,
    };

    const order = new orderModel(orderData);
    await order.save();

    // SSOT invoice — created unpaid, then settled by whatever the customer pays below.
    const invoice = await createProjectInvoice({
      customerId: userId,
      orderId: order._id,
      amount: finalPrice,
      lineItems: [{ name: plan.serviceName, price: finalPrice }],
      invoiceDate: new Date(),
    });

    // ----- Payment. The wallet/UPI split is decided HERE, server-side, from the
    // customer's real balance — the client never tells us how much came from
    // wallet. Wallet is instant (own money); any UPI remainder waits for admin. -----
    let walletPaid = 0;
    let upiPending = 0;
    const linkedTransactionIds = [];

    if (!paymentDetails || !paymentDetails.transactionId) {
      return res.status(400).json({
        message: "Payment details are required",
        error: true,
        success: false,
      });
    }

    const parentTxnId = paymentDetails.transactionId;

    const customer = await userModel.findById(userId).select("walletBalance");
    const walletBalance = Number(customer?.walletBalance || 0);
    const walletPart = Math.min(walletBalance, finalPrice);
    const upiPart = finalPrice - walletPart;

    if (upiPart > 0 && !paymentDetails.upiTransactionId) {
      return res.status(400).json({
        message: "UPI transaction ID is required for the amount not covered by wallet",
        error: true,
        success: false,
      });
    }

    // Wallet portion — instant, no approval, debited atomically by the server.
    if (walletPart > 0) {
      const walletTxn = await deductWalletInstant({
        userId,
        transactionId: `${parentTxnId}-W`,
        amount: walletPart,
        orderId: order._id,
        description: `Payment (wallet) for service plan order ${order._id}`,
        parentTransactionId: upiPart > 0 ? parentTxnId : null,
      });
      walletPaid = walletPart;
      linkedTransactionIds.push(walletTxn.transactionId);

      // Settle the invoice by exactly the wallet amount, reusing the SAME wallet
      // transaction — a payment never writes two transactions.
      if (invoice) {
        await markProjectInvoicePaid({
          invoice,
          customerId: userId,
          paymentMethod: "wallet",
          amount: walletPart,
          existingTransaction: walletTxn.transaction,
        });
      }
    }

    // UPI portion — pending admin approval, linked to the invoice so approving it
    // later settles that SAME invoice instead of leaving it partially paid forever.
    if (upiPart > 0) {
      const upiTransaction = await createPaymentTransaction({
        userId,
        transactionId: parentTxnId,
        amount: upiPart,
        upiTransactionId: paymentDetails.upiTransactionId,
        paymentMethod: "upi",
        orderId: order._id,
        invoiceId: invoice?._id || null,
        description: `Payment (UPI) for service plan order ${order._id}`,
      });
      upiPending = upiPart;
      linkedTransactionIds.push(upiTransaction.transactionId);
    }

    order.paidAmount = walletPaid;
    order.remainingAmount = Math.max(0, finalPrice - walletPaid);

    // Fully covered by wallet => approve now. Any UPI remainder keeps the order
    // pending until admin approves that transaction.
    if (upiPart === 0) {
      order.paymentComplete = true;
      order.orderVisibility = "approved";
      if (order.status === "pending") order.status = "in_progress";
    }

    await order.save();

    return res.status(201).json({
      message: "Service plan purchased successfully",
      success: true,
      error: false,
      data: {
        orderId: order._id,
        finalPrice,
        walletPaid,
        upiPending,
        linkedTransactionIds,
        invoiceId: invoice?._id || null,
        servicePlanStartDate: startDate,
        servicePlanEndDate: endDate,
        linkedProjectOrderId: order.linkedProjectOrderId,
      },
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to purchase service plan",
      error: true,
      success: false,
    });
  }
};

module.exports = customerCreateServicePlanOrder;
