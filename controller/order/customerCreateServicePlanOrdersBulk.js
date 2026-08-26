const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const paymentBatchModel = require("../../models/paymentBatchModel");
const { createProjectInvoice, markProjectInvoicePaid } = require("../../helpers/paymentRecording");
const { settleServiceCycle } = require("../../helpers/serviceCycleSettlement");
const { createPaymentTransaction, deductWalletInstant } = require("../../helpers/transactionService");
const {
  SERVICE_PLAN_CATEGORY,
  buildServicePlanOrderData,
  resolveServicePlanPrice,
  resolveValidityInDays,
  runsIndefinitely,
  resolveCustomerBillingSelection,
} = require("../../helpers/servicePlanPurchase");

// Bulk Service Plan purchase — buy several services in one go by wallet, UPI, or a
// combination of both (parent-child payment model).
//
// Previously this path was WALLET ONLY, because the approval engine settles exactly
// ONE order/invoice per transaction (transactionModel.orderId/invoiceId are single
// refs), so one UPI payment covering N orders would leave N-1 pending forever.
//
// That is solved here without touching the single-order approval logic (docs 52/53):
//
//   BATCH record (paymentBatchModel) = the approval group the admin acts on. NOT a
//                         transaction: a transaction means one payment against one order,
//                         which a batch can never be. See paymentBatchModel.js.
//   CHILD transactions  = one per service, each carrying parentTransactionId (= batchRef)
//                         and its own orderId/invoiceId — the exact single-ref shape the
//                         rest of the system already expects.
//
// Approving the batch settles every child (see settleChildTransactions in
// transactionApprovalController.js); rejecting it rejects them all and refunds any
// wallet portion. So all approvals for services added to a project stay under that
// one payment, which is how this business already works.
//
// Split is decided SERVER-SIDE from the real balance, never sent by the client:
//   walletPart = min(walletBalance, total)   -> instant debit, no approval
//   upiPart    = total - walletPart          -> pending parent transaction
//
// Fully wallet-covered => every service activates immediately.
// Any UPI remainder    => every service stays pending-approval until the parent is approved.
//
// All-or-nothing: a mid-batch failure rolls the whole batch back.

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
      upiTransactionId,
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

    // ----- Decide the wallet/UPI split SERVER-SIDE from the real balance. The
    // client's idea of the split is never trusted (that was the original loophole,
    // doc 51 Part B). The wallet is the customer's own already-approved money, so
    // it is spent instantly; only the UPI remainder needs admin approval. -----
    const customer = await userModel.findById(userId).select("walletBalance");
    const walletBalance = Number(customer?.walletBalance || 0);
    const walletPart = Math.min(walletBalance, totalAmount);
    const upiPart = totalAmount - walletPart;

    if (upiPart > 0 && !upiTransactionId) {
      return res.status(400).json({
        message: "UPI transaction ID is required for the amount not covered by wallet",
        error: true,
        success: false,
        data: { totalAmount, walletBalance, walletPart, upiPart },
      });
    }

    // The parent reference is what the admin will approve. Children hang off it.
    const parentTxnId = transactionId;
    // Every service is paid in full (owner's rule), so each one's wallet/UPI share is
    // its own price scaled by the batch split. Computed per service below.
    const isCombined = walletPart > 0 && upiPart > 0;

    // ----- Allocate the batch's wallet money across the services, in order, until
    // it runs out. Allocating sequentially (rather than pro-rating each service)
    // keeps every share a whole rupee, so the per-service parts always add back up
    // to the batch total exactly — no rounding drift, no stray paisa. -----
    let walletLeftToAllocate = walletPart;
    const allocation = priced.map(({ price }) => {
      const walletShare = Math.min(walletLeftToAllocate, price);
      walletLeftToAllocate -= walletShare;
      return { walletShare, upiShare: price - walletShare };
    });

    // ----- Create each service: order -> invoice -> wallet debit (its share) ->
    // settle invoice -> child UPI transaction (its share). Identical in shape to the
    // single-service path, once per service. -----
    for (let index = 0; index < priced.length; index += 1) {
      const { plan, price, validityInDays, billingSelection } = priced[index];
      const { walletShare, upiShare } = allocation[index];

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
      created.push({ order, invoice: null, walletTxn: null, childTxn: null });

      const invoice = await createProjectInvoice({
        customerId: userId,
        orderId: order._id,
        amount: price,
        lineItems: [{ name: plan.serviceName, price }],
        invoiceDate: new Date(),
        serviceCycleNumber: 1,
      });
      created[index].invoice = invoice;

      // Wallet share — instant, no approval, debited atomically by the server.
      // Carries parentTransactionId whenever a UPI part exists, so rejecting the
      // parent later can find and refund this debit (same mechanism the combined
      // single-order path already relies on).
      if (walletShare > 0) {
        const walletTxn = await deductWalletInstant({
          userId,
          transactionId: `${parentTxnId}-S${index + 1}-W`,
          amount: walletShare,
          orderId: order._id,
          description: `Payment (wallet) for service plan order ${order._id}`,
          parentTransactionId: isCombined ? parentTxnId : null,
        });
        created[index].walletTxn = walletTxn;

        // Settle the invoice by exactly the wallet amount, reusing the SAME
        // transaction — a payment never writes two transactions.
        if (invoice) {
          const settled = await markProjectInvoicePaid({
            invoice,
            customerId: userId,
            paymentMethod: "wallet",
            amount: walletShare,
            existingTransaction: walletTxn.transaction,
          });
          invoice.status = settled.invoice.status;
          invoice.amountPaid = settled.invoice.amountPaid;
          invoice.paidDate = settled.invoice.paidDate;
        }
      }

      // UPI share — a CHILD transaction, pending until the admin approves the parent.
      // It carries this service's own orderId/invoiceId, so when the parent is
      // approved each child settles through the very same single-order code path
      // that has always handled one payment for one order.
      if (upiShare > 0) {
        const childTxn = await createPaymentTransaction({
          userId,
          transactionId: `${parentTxnId}-S${index + 1}`,
          amount: upiShare,
          upiTransactionId,
          paymentMethod: "upi",
          orderId: order._id,
          invoiceId: invoice?._id || null,
          parentTransactionId: parentTxnId,
          description: `Payment (UPI) for service plan order ${order._id}`,
        });
        created[index].childTxn = childTxn;
      }

      order.paidAmount = walletShare;
      order.remainingAmount = Math.max(0, price - walletShare);

      // Fully covered by wallet => active immediately. Any UPI share keeps this
      // service pending until the parent transaction is approved.
      if (upiShare === 0) {
        order.paymentComplete = true;
        order.orderVisibility = "approved";
        if (order.status === "pending") order.status = "in_progress";
      }
      await order.save();
      if (upiShare === 0 && invoice.status === "paid") {
        await settleServiceCycle({ orderId: order._id, invoice });
      }
    }

    // ----- The BATCH record: the single pending entry the admin approves or rejects for
    // this whole purchase. Created after the children so that, if anything above fails,
    // no batch is ever left pointing at a rolled-back purchase.
    //
    // This is deliberately NOT a transactionModel row. A transaction means "one real payment
    // applied to one order" (single orderId/invoiceId refs, and transactionService.js infers
    // "no orderId => wallet recharge"). A batch covers N orders, so it can never satisfy that
    // shape — forcing it in produced an orderId-less transaction that had to override the
    // wallet-recharge inference and still showed up in the admin ledger as a nameless payment
    // in the "Wallet / General Payments" bucket. See paymentBatchModel.js.
    //
    // The real money stays in the children (one per service, each with its own orderId/
    // invoiceId). batchRef reuses parentTxnId — the exact value children already carry in
    // parentTransactionId — so every child lookup, wallet-refund query and rollback below
    // keeps working unchanged.
    let paymentBatch = null;
    if (upiPart > 0) {
      paymentBatch = await paymentBatchModel.create({
        userId,
        batchRef: parentTxnId,
        upiTransactionId,
        totalAmount,
        walletPart,
        upiPart,
        paymentMethod: isCombined ? "combined" : "upi",
        linkedProjectOrderId: linkedOrder ? linkedOrder._id : null,
        orderIds: created.filter((item) => item.order).map((item) => item.order._id),
        childTransactionIds: created
          .filter((item) => item.childTxn)
          .map((item) => item.childTxn.transactionId),
        status: "pending-approval",
      });

      created.push({ batchOnly: true, paymentBatch });
    }

    const approved = upiPart === 0;

    return res.status(201).json({
      message: approved
        ? priced.length === 1
          ? "Service added successfully"
          : `${priced.length} services added successfully`
        : priced.length === 1
        ? "Service submitted for approval"
        : `${priced.length} services submitted for approval`,
      success: true,
      error: false,
      data: {
        totalAmount,
        walletPaid: walletPart,
        upiPending: upiPart,
        approved,
        batchRef: paymentBatch ? paymentBatch.batchRef : null,
        count: priced.length,
        orders: priced.map((item, index) => ({
          orderId: created[index].order._id,
          name: item.plan.serviceName,
          amount: item.price,
          invoiceId: created[index].invoice?._id || null,
          walletPaid: allocation[index].walletShare,
          upiPending: allocation[index].upiShare,
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
        // The batch entry has no order/invoice of its own — just remove it.
        if (item.batchOnly) {
          if (item.paymentBatch?._id) {
            await paymentBatchModel.deleteOne({ _id: item.paymentBatch._id });
          }
          continue;
        }
        // A pending child UPI transaction took no money yet, so it is simply removed.
        if (item.childTxn?._id) {
          await transactionModel.deleteOne({ _id: item.childTxn._id });
        }
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
