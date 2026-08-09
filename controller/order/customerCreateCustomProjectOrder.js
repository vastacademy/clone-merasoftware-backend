const mongoose = require("mongoose");
const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const categoryBasePriceModel = require("../../models/categoryBasePriceModel");
const { initializeProjectTimeline } = require("../../helpers/projectNodeService");

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
const buildInstallments = (totalAmount, installmentCount) => {
  const count = Number(installmentCount) === 3 ? 3 : 2;
  const splits = count === 3 ? [30, 30, 40] : [50, 50];

  return splits.map((percentage, index) => ({
    installmentNumber: index + 1,
    percentage,
    amount: Math.round((totalAmount * percentage) / 100),
    paid: false,
    paymentStatus: "none",
    // Installment #1 is due immediately; later ones staggered 30 days apart.
    dueDate: new Date(Date.now() + index * 30 * 24 * 60 * 60 * 1000),
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

    // First installment amount the client should pay now (partial only).
    const firstInstallmentAmount = isPartialPayment
      ? order.installments[0].amount
      : finalPrice;

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
