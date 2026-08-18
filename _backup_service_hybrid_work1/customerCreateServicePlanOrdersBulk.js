const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const { createProjectInvoice, markProjectInvoicePaid } = require("../../helpers/paymentRecording");
const { deductWalletInstant } = require("../../helpers/transactionService");
const {
  SERVICE_PLAN_CATEGORY,
  buildServicePlanOrderData,
  resolveServicePlanPrice,
  resolveValidityInDays,
  runsIndefinitely,
  resolveCustomerBillingSelection,
} = require("../../helpers/servicePlanPurchase");

// Bulk Service Plan purchase — buy several services in one go, WALLET ONLY.
//
// Why wallet-only, deliberately (see doc 55 §10): the existing approval engine
// (transactionApprovalController.js) settles exactly ONE order/invoice per
// transaction — transactionModel.orderId/invoiceId are single refs, not arrays.
// A UPI payment covering N orders would therefore leave N-1 of them pending
// forever. Wallet money needs no approval at all, so each service can get its
// own transaction/order/invoice and settle instantly, with no change to that
// carefully-corrected approval logic (docs 52/53).
//
// A customer whose wallet can't cover the total is told to recharge or buy one
// at a time — the single-service endpoint still handles wallet/UPI/combined.
//
// All-or-nothing: the total is checked against the balance up front, and the
// whole batch is rolled back if any service fails partway.

const customerCreateServicePlanOrdersBulk = async (req, res) => {
  // Tracks what has been written so a mid-batch failure can be undone. Mongo
  // transactions aren't used here because the deployment isn't guaranteed to be
  // a replica set; compensating deletes/refunds are the established pattern.
  const created = [];

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
      planIds,
      linkedProjectOrderId,
      addedDuringProjectPhase,
      transactionId,
      selections,
    } = req.body;

    if (!Array.isArray(planIds) || planIds.length === 0) {
      return res.status(400).json({
        message: "At least one service is required",
        error: true,
        success: false,
      });
    }

    if (!transactionId) {
      return res.status(400).json({
        message: "Payment reference is required",
        error: true,
        success: false,
      });
    }

    // De-duplicate: buying the same service twice in one batch is always a UI
    // slip, never an intent.
    const uniquePlanIds = [...new Set(planIds.map(String))];
    const selectionByPlanId = new Map(Array.isArray(selections) ? selections.map((selection) => [String(selection.planId), selection]) : []);

    // ----- Load and validate every plan BEFORE taking any money -----
    const plans = await productModel.find({
      _id: { $in: uniquePlanIds },
      category: SERVICE_PLAN_CATEGORY,
      isServicePlan: true,
      isHidden: { $ne: true },
    });

    if (plans.length !== uniquePlanIds.length) {
      return res.status(400).json({
        message: "One or more selected services are no longer available",
        error: true,
        success: false,
      });
    }

    // Price and duration are re-derived server-side for every plan — the client
    // never tells us what anything costs.
    const priced = [];
    for (const plan of plans) {
      const selection = selectionByPlanId.get(String(plan._id));
      const billingSelection = Array.isArray(plan.servicePlan?.billingOptions) && plan.servicePlan.billingOptions.length
        ? resolveCustomerBillingSelection({ servicePlan: plan.servicePlan, billingCycle: selection?.selectedBillingCycle, tenureMonths: selection?.tenureMonths })
        : null;
      const price = billingSelection ? billingSelection.firstPayment : resolveServicePlanPrice(plan);
      const validityInDays = resolveValidityInDays(plan.servicePlan || {});

      if (!Number.isFinite(price) || price <= 0) {
        return res.status(400).json({
          message: `"${plan.serviceName}" has no valid price. Please contact support.`,
          error: true,
          success: false,
        });
      }
      if (!billingSelection && !runsIndefinitely(plan.servicePlan || {}) && (!Number.isFinite(validityInDays) || validityInDays <= 0)) {
        return res.status(400).json({
          message: `"${plan.serviceName}" has no valid duration. Please contact support.`,
          error: true,
          success: false,
        });
      }
      priced.push({ plan, price, validityInDays, billingSelection });
    }

    const totalAmount = priced.reduce((sum, item) => sum + item.price, 0);

    // ----- Verify the add-on linkage (never trusted from the client) -----
    let linkedOrder = null;
    if (linkedProjectOrderId) {
      linkedOrder = await orderModel.findOne({ _id: linkedProjectOrderId, userId });
      if (!linkedOrder) {
        return res.status(400).json({
          message: "The project these services are being added to was not found",
          error: true,
          success: false,
        });
      }
    }

    // The phase is re-derived from the project's real progress; the client's
    // value is only a UI hint.
    const resolvedPhase = linkedOrder
      ? linkedOrder.projectProgress >= 100 || linkedOrder.currentPhase === "completed"
        ? "after_completion"
        : "in_progress"
      : null;

    if (!linkedOrder && addedDuringProjectPhase) {
      return res.status(400).json({
        message: "A project phase cannot be set without a project",
        error: true,
        success: false,
      });
    }

    // ----- Wallet must cover the WHOLE batch. Checked up front so we never
    // start charging for a batch we can't finish. The per-debit atomic guard in
    // deductWalletInstant remains the real race-safe authority. -----
    const customer = await userModel.findById(userId).select("walletBalance");
    const walletBalance = Number(customer?.walletBalance || 0);

    if (walletBalance < totalAmount) {
      return res.status(400).json({
        message:
          "Your wallet doesn't cover the total for these services. Add money to your wallet, or buy them one at a time.",
        error: true,
        success: false,
        data: { totalAmount, walletBalance, shortfall: totalAmount - walletBalance },
      });
    }

    // ----- Create each service: order -> invoice -> instant wallet debit ->
    // settle invoice. Identical to the single-service path, once per service. -----
    for (let index = 0; index < priced.length; index += 1) {
      const { plan, price, validityInDays, billingSelection } = priced[index];

      const order = new orderModel(
        buildServicePlanOrderData({
          userId,
          plan,
          price,
          validityInDays,
          linkedProjectOrderId: linkedOrder ? linkedOrder._id : null,
          addedDuringProjectPhase: resolvedPhase,
          billingSelection,
        })
      );
      await order.save();
      created.push({ order, invoice: null, walletTxn: null });

      const invoice = await createProjectInvoice({
        customerId: userId,
        orderId: order._id,
        amount: price,
        lineItems: [{ name: plan.serviceName, price }],
        invoiceDate: new Date(),
      });
      created[index].invoice = invoice;

      // Each service gets its own transaction, suffixed off the batch reference,
      // so every order has exactly one transaction — the shape the rest of the
      // system (ledger, approval, history) already expects.
      const walletTxn = await deductWalletInstant({
        userId,
        transactionId: `${transactionId}-S${index + 1}`,
        amount: price,
        orderId: order._id,
        description: `Payment (wallet) for service plan order ${order._id}`,
      });
      created[index].walletTxn = walletTxn;

      if (invoice) {
        await markProjectInvoicePaid({
          invoice,
          customerId: userId,
          paymentMethod: "wallet",
          amount: price,
          existingTransaction: walletTxn.transaction,
        });
      }

      // Fully paid from wallet => active immediately, no approval step.
      order.paidAmount = price;
      order.remainingAmount = 0;
      order.paymentComplete = true;
      order.orderVisibility = "approved";
      if (order.status === "pending") order.status = "in_progress";
      await order.save();
    }

    return res.status(201).json({
      message:
        priced.length === 1
          ? "Service added successfully"
          : `${priced.length} services added successfully`,
      success: true,
      error: false,
      data: {
        totalAmount,
        count: priced.length,
        orders: created.map((item, index) => ({
          orderId: item.order._id,
          name: priced[index].plan.serviceName,
          amount: priced[index].price,
          invoiceId: item.invoice?._id || null,
        })),
        linkedProjectOrderId: linkedOrder ? linkedOrder._id : null,
      },
    });
  } catch (error) {
    // ----- Compensating rollback: undo whatever this batch already wrote, so a
    // partial failure never leaves the customer charged for services they
    // didn't get. Refunds first (money matters most), then records. -----
    const { refundWalletInstant } = require("../../helpers/transactionService");
    const invoiceModel = require("../../models/invoiceModel");
    const transactionModel = require("../../models/transactionModel");

    for (const item of created) {
      try {
        if (item.walletTxn?.transaction) {
          await refundWalletInstant({
            userId: req.userId,
            transactionId: `${item.walletTxn.transaction.transactionId}-RB`,
            amount: item.walletTxn.transaction.amount,
            description: `Rollback of failed service plan batch (order ${item.order._id})`,
            orderId: item.order._id,
          });
          await transactionModel.deleteOne({ _id: item.walletTxn.transaction._id });
        }
        if (item.invoice?._id) await invoiceModel.deleteOne({ _id: item.invoice._id });
        if (item.order?._id) await orderModel.deleteOne({ _id: item.order._id });
      } catch (rollbackError) {
        // A rollback failure must be visible — it means manual cleanup is needed.
        console.error(
          `Service plan batch rollback failed for order ${item.order?._id}:`,
          rollbackError.message
        );
      }
    }

    return res.status(400).json({
      message: error.message || "Failed to add services",
      error: true,
      success: false,
    });
  }
};

module.exports = customerCreateServicePlanOrdersBulk;
