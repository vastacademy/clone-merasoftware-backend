const mongoose = require("mongoose");
const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const categoryBasePriceModel = require("../../models/categoryBasePriceModel");
const { initializeProjectTimeline } = require("../../helpers/projectNodeService");
// SSOT: every project order gets an unpaid invoice at creation, via the same shared
// helper used by adminCreateProjectOrder.js and approveProjectOrder.js — so "invoice
// pending" and "project pending" always exist together, never fragmented.
const { createProjectInvoice, markProjectInvoicePaid } = require("../../helpers/paymentRecording");
// Shared transaction-creation SSOT — the order and its payment are created together in one
// request (never a payment-less order). Wallet is the customer's own money so it is debited
// instantly (deductWalletInstant); any UPI remainder is a pending transaction the admin approves.
const {
  createPaymentTransaction,
  deductWalletInstant,
} = require("../../helpers/transactionService");
const userModel = require("../../models/userModel");
const { syncProjectFinalInvoice } = require("../../helpers/projectFinalInvoice");

// Customer-side twin of adminCreateProjectOrder.js. The customize flow
// (StartNewWebsiteCustomize.js) is product-less: the customer describes a project
// instead of buying a catalog product, so we build a hidden product on the fly,
// re-derive the price server-side, and create a pending-approval order the customer
// then pays for via the existing /wallet/verify-payment approval chain.

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const FEATURE_UPGRADE_CATEGORY = "feature_upgrades";

const CATEGORY_LABELS = {
  standard_websites: "Static Website",
  dynamic_websites: "Dynamic Website",
  cloud_software_development: "Cloud Software",
  app_development: "Mobile App",
};

const PAYMENT_TYPES = ["full", "partial", "decide_later"];

const DEFAULT_STARTING_NODE_TITLE = "Project Started";

const MIN_PAGES = 4;
const MAX_PAGES = 99;

const isPagesFeature = (feature) =>
  (feature?.serviceName || "").toLowerCase().includes("add new page");

// Same split conventions as adminCreateProjectOrder.js: 2 => 50/50, 3 => 30/30/40.
// Default progress-gate thresholds (node-system %, admin-editable per project — Layer B):
// installment #1 (advance) has no threshold (always due at creation, gates nothing);
// 2-installment split: #2 due at 90% progress; 3-installment split: #2 at 50%, #3 at 90%.
const DEFAULT_PROGRESS_THRESHOLDS = {
  2: [null, 90],
  3: [null, 50, 90],
};

const buildInstallments = (totalAmount, installmentCount) => {
  const count = Number(installmentCount) === 3 ? 3 : 2;
  const splits = count === 3 ? [30, 30, 40] : [50, 50];
  const thresholds = DEFAULT_PROGRESS_THRESHOLDS[count];

  return splits.map((percentage, index) => ({
    installmentNumber: index + 1,
    percentage,
    amount: Math.round((totalAmount * percentage) / 100),
    paid: false,
    paymentStatus: "none",
    // Installment #1 is due immediately; later ones staggered 30 days apart.
    dueDate: new Date(Date.now() + index * 30 * 24 * 60 * 60 * 1000),
    progressThreshold: thresholds[index],
  }));
};

const customerCreateCustomProjectOrder = async (req, res) => {
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
      category,
      pageCount,
      featureIds: requestedFeatureIds = [],
      budget,
      ownership,
      paymentType = "full",
      installmentCount,
      couponCode,
      // Payment details for full/partial: the customer pays first (wallet/UPI), then this
      // one request creates the order + invoice + the pending payment transaction together.
      paymentDetails,
    } = req.body;

    if (!category || !PROJECT_CATEGORIES.includes(category)) {
      return res.status(400).json({
        message: "Valid project category is required",
        error: true,
        success: false,
      });
    }

    if (!PAYMENT_TYPES.includes(paymentType)) {
      return res.status(400).json({
        message: "Invalid payment type",
        error: true,
        success: false,
      });
    }

    // A full/partial order must never be created without an accompanying payment — that was
    // the old bug where an unpaid order reached the admin. decide_later is the only path
    // that intentionally creates an order with no payment (admin handles payment later).
    const requiresPayment = paymentType !== "decide_later";
    if (requiresPayment && !paymentDetails?.transactionId) {
      return res.status(400).json({
        message: "Payment details are required to create this project order",
        error: true,
        success: false,
      });
    }

    // ----- Price is re-derived server-side; nothing money-related is trusted from the body -----
    const basePriceEntry = await categoryBasePriceModel.findOne({ category }).lean();
    const basePrice = basePriceEntry?.basePrice || 0;

    const requestedIds = Array.isArray(requestedFeatureIds)
      ? requestedFeatureIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];

    // Only real, non-hidden feature_upgrades compatible with this category count —
    // mirrors the exact filter StartNewWebsiteCustomize.js uses on the client.
    const featureDocs = requestedIds.length
      ? await productModel
          .find({
            _id: { $in: requestedIds },
            category: FEATURE_UPGRADE_CATEGORY,
            isHidden: { $ne: true },
            compatibleWith: category,
          })
          .select("serviceName sellingPrice price compatibleWith")
          .lean()
      : [];

    // The "Add New Page" feature is priced per page (sellingPrice x pageCount),
    // clamped to the same MIN/MAX the UI enforces. All other features count once.
    const clampedPageCount = Math.min(
      MAX_PAGES,
      Math.max(MIN_PAGES, Number(pageCount) || MIN_PAGES)
    );

    const clientProjectFeatures = [];
    let featuresTotal = 0;

    featureDocs.forEach((feature) => {
      const unitPrice = feature.sellingPrice || feature.price || 0;
      if (isPagesFeature(feature)) {
        const pagesPrice = unitPrice * clampedPageCount;
        featuresTotal += pagesPrice;
        clientProjectFeatures.push({
          featureId: feature._id,
          name: `${feature.serviceName} (${clampedPageCount} pages)`,
          price: pagesPrice,
        });
      } else {
        featuresTotal += unitPrice;
        clientProjectFeatures.push({
          featureId: feature._id,
          name: feature.serviceName,
          price: unitPrice,
        });
      }
    });

    const finalPrice = basePrice + featuresTotal;
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({
        message:
          "Could not determine a price for this project. Please contact support.",
        error: true,
        success: false,
      });
    }

    const startingNodeTitle =
      basePriceEntry?.startingNodeTitle?.trim() || DEFAULT_STARTING_NODE_TITLE;

    // Build the hidden, customer-specific product (product-less flow, same as admin path).
    const project = new productModel({
      serviceName: CATEGORY_LABELS[category],
      category,
      startingNodeTitle,
      totalPages: clampedPageCount,
      price: finalPrice,
      sellingPrice: finalPrice,
      clientProjectFeatures,
      isHidden: true,
      isCustomClientProject: true,
    });

    await project.save();

    const isPartialPayment = paymentType === "partial";

    const orderData = {
      userId,
      productId: project._id,
      quantity: 1,
      price: finalPrice,
      originalPrice: finalPrice,
      totalAmount: finalPrice,
      // Customer-initiated => needs admin approval before it goes live.
      orderVisibility: "pending-approval",
      isWebsiteProject: true,
      isPartialPayment,
      paidAmount: 0,
      remainingAmount: finalPrice,
      paymentComplete: false,
      projectProgress: 0,
      messages: [],
      orderItems: [
        {
          id: project._id.toString(),
          name: `${CATEGORY_LABELS[category]} (Base)`,
          type: "main",
          quantity: 1,
          originalPrice: basePrice,
          finalPrice: basePrice,
        },
        ...clientProjectFeatures.map((feature) => ({
          id: feature.featureId.toString(),
          name: feature.name,
          type: "feature",
          quantity: 1,
          originalPrice: feature.price,
          finalPrice: feature.price,
        })),
      ],
    };

    if (couponCode) {
      orderData.couponApplied = couponCode;
    }

    if (isPartialPayment) {
      orderData.installments = buildInstallments(finalPrice, installmentCount);
      orderData.currentInstallment = 1;
    }

    const order = new orderModel(orderData);

    // Every website-project order starts its dynamic timeline at 0% (same as both
    // existing creation paths).
    initializeProjectTimeline({ order, startingNodeTitle, actorId: userId });

    await order.save();

    // SSOT invoice creation — an invoice is only created for money that is DUE NOW (doc 52 §3
    // rule 1): a single invoice for full/decide-later, or ONLY installment #1's invoice for
    // partial. Installments #2, #3, ... get their own invoice later, when they actually become
    // due (doc 52 Phase 3 — created at pay-time by whichever surface collects that installment's
    // payment, e.g. InstallmentPayment.js's backend). All unpaid at creation; whichever part of
    // the payment settles instantly (wallet) marks it paid/partially_paid right below, and any UPI
    // remainder settles it further when admin approves (transactionApprovalController).
    const lineItems = [
      { name: `${CATEGORY_LABELS[category]} (Base)`, price: basePrice },
      ...clientProjectFeatures.map((feature) => ({ name: feature.name, price: feature.price })),
    ];
    const invoiceDate = new Date();
    // The invoice covering the amount due NOW (installment #1 for partial, the only invoice for
    // full) — this is the one instant wallet money settles below.
    const dueInvoice = isPartialPayment
      ? await createProjectInvoice({
          customerId: userId,
          orderId: order._id,
          amount: order.installments[0].amount,
          lineItems,
          installmentNumber: order.installments[0].installmentNumber,
          invoiceDate,
          dueDate: order.installments[0].dueDate || invoiceDate,
        })
      : await createProjectInvoice({
          customerId: userId,
          orderId: order._id,
          amount: finalPrice,
          lineItems,
          invoiceDate,
        });

    // First installment amount the client should pay now (partial only).
    const firstInstallmentAmount = isPartialPayment
      ? order.installments[0].amount
      : finalPrice;

    // ----- Payment (full/partial only) — the wallet/UPI split is decided HERE, server-side,
    // from the customer's real balance. The client never tells us how much came from wallet;
    // trusting a client-sent split was the old loophole. Wallet is instant (own money); any
    // UPI remainder is a pending transaction the admin approves. -----
    let walletPaid = 0;
    let upiPending = 0;
    let upiTransaction = null;
    const linkedTransactionIds = [];

    if (requiresPayment) {
      const amountDueNow = firstInstallmentAmount;
      const parentTxnId = paymentDetails.transactionId;

      const customer = await userModel.findById(userId).select("walletBalance");
      const walletBalance = Number(customer?.walletBalance || 0);
      const walletPart = Math.min(walletBalance, amountDueNow);
      const upiPart = amountDueNow - walletPart;

      // A UPI remainder requires a UPI reference from the client.
      if (upiPart > 0 && !paymentDetails.upiTransactionId) {
        return res.status(400).json({
          message: "UPI transaction ID is required for the amount not covered by wallet",
          error: true,
          success: false,
        });
      }

      const paymentLabel = isPartialPayment ? "First installment" : "Payment";

      // Wallet portion — instant, no approval. Debited atomically by the server.
      if (walletPart > 0) {
        const walletTxn = await deductWalletInstant({
          userId,
          transactionId: `${parentTxnId}-W`,
          amount: walletPart,
          orderId: order._id,
          installmentNumber: isPartialPayment ? 1 : null,
          isInstallmentPayment: isPartialPayment,
          description: `${paymentLabel} (wallet) for custom project order ${order._id}`,
          // A combined payment links both parts; a wallet-only payment has no parent.
          parentTransactionId: upiPart > 0 ? parentTxnId : null,
        });
        walletPaid = walletPart;
        linkedTransactionIds.push(walletTxn.transactionId);

        // Settle the due invoice by exactly the wallet amount, reusing the SAME wallet
        // transaction (no second transaction — doc 52 Q1). Fully covers it -> 'paid' instantly;
        // a combined payment's wallet part -> 'partially_paid' until the UPI part is approved.
        if (dueInvoice) {
          await markProjectInvoicePaid({
            invoice: dueInvoice,
            customerId: userId,
            paymentMethod: "wallet",
            amount: walletPart,
            existingTransaction: walletTxn.transaction,
          });
        }
      }

      // UPI portion — pending admin approval. Linked to the due invoice (invoiceId) so approving
      // it later settles that SAME invoice for the remaining amount (transactionApprovalController,
      // doc 52 Phase 5) instead of leaving it stuck at 'partially_paid' forever.
      if (upiPart > 0) {
        upiTransaction = await createPaymentTransaction({
          userId,
          transactionId: parentTxnId,
          amount: upiPart,
          upiTransactionId: paymentDetails.upiTransactionId,
          paymentMethod: "upi",
          orderId: order._id,
          invoiceId: dueInvoice?._id || null,
          installmentNumber: isPartialPayment ? 1 : null,
          isInstallmentPayment: isPartialPayment,
          description: `${paymentLabel} (UPI) for custom project order ${order._id}`,
        });
        upiPending = upiPart;
        linkedTransactionIds.push(upiTransaction.transactionId);
      }

      // Order money + approval state:
      //  - fully covered by wallet (no UPI): auto-approve now, first installment is paid.
      //  - any UPI remainder: stays 'pending-approval'; approving the UPI transaction later
      //    (transactionApprovalController) records the rest and flips the order to 'approved'.
      order.paidAmount = walletPaid;
      order.remainingAmount = Math.max(0, finalPrice - walletPaid);

      if (upiPart === 0) {
        if (isPartialPayment) {
          order.installments[0].paid = true;
          order.installments[0].paymentStatus = "none";
          order.installments[0].paidDate = new Date();
          order.currentInstallment = order.installments[1]?.installmentNumber || 1;
        } else {
          order.paymentComplete = true;
        }
        order.orderVisibility = "approved";
        if (order.status === "pending") order.status = "in_progress";
      }

      await order.save();
      if (walletPaid > 0) await syncProjectFinalInvoice(order);
    }

    return res.status(201).json({
      message: "Project request created successfully",
      success: true,
      error: false,
      data: {
        orderId: order._id,
        finalPrice,
        paymentType,
        installments: isPartialPayment ? order.installments : [],
        firstInstallmentAmount,
        walletPaid,
        upiPending,
        approved: requiresPayment ? upiPending === 0 : false,
        transactionIds: linkedTransactionIds,
      },
    });
  } catch (error) {
    console.error("Error creating custom project order:", error);
    return res.status(500).json({
      message: error.message || "Failed to create custom project order",
      error: true,
      success: false,
    });
  }
};

module.exports = customerCreateCustomProjectOrder;
