const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");
const categoryBasePriceModel = require("../../models/categoryBasePriceModel");
const invoiceModel = require("../../models/invoiceModel");
const generateInvoiceNumber = require("../../helpers/generateInvoiceNumber");
const { initializeProjectTimeline } = require("../../helpers/projectNodeService");
// Shared SSOT payment-recording helper (extracted from this file) — reused by the
// project-approval flow so both paths write one transaction + one invoice, never two.
const { markProjectInvoicePaid } = require("../../helpers/paymentRecording");

const PAYMENT_METHODS = ["upi", "bank_transfer", "cash", "wallet"];

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const FEATURE_UPGRADE_CATEGORY = "feature_upgrades";

const CATEGORY_LABELS = {
  standard_websites: "Standard Website",
  dynamic_websites: "Dynamic Website",
  cloud_software_development: "Cloud Software",
  app_development: "App Development",
};

const buildInstallments = (totalAmount, installmentCount) => {
  const count = Number(installmentCount) === 3 ? 3 : 2;
  const splits = count === 3 ? [30, 30, 40] : [50, 50];

  return splits.map((percentage, index) => ({
    installmentNumber: index + 1,
    percentage,
    amount: Math.round((totalAmount * percentage) / 100),
    paid: false,
    paymentStatus: "none",
  }));
};

const adminCreateProjectOrderController = async (req, res) => {
  try {
    const adminUser = await userModel.findById(req.userId).select("roles");
    if (req.userRole !== "admin" || !adminUser?.roles?.includes("admin")) {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        message: "Valid customerId is required",
        error: true,
        success: false,
      });
    }

    const client = await userModel.findById(customerId).select("_id");
    if (!client) {
      return res.status(404).json({
        message: "Client not found",
        error: true,
        success: false,
      });
    }

    const {
      startingNodeTitle,
      category,
      totalPages,
      sellingPrice,
      featureIds: requestedFeatureIds = [],
      paymentType,
      installmentCount,
      recordPayment,
    } = req.body;

    if (!startingNodeTitle?.trim() || !category || !sellingPrice) {
      return res.status(400).json({
        message: "Starting node title, category, and selling price are required",
        error: true,
        success: false,
      });
    }

    if (!PROJECT_CATEGORIES.includes(category)) {
      return res.status(400).json({
        message: "Invalid project category",
        error: true,
        success: false,
      });
    }

    const finalPrice = Number(sellingPrice);
    if (!Number.isFinite(finalPrice) || finalPrice <= 0) {
      return res.status(400).json({
        message: "Selling price must be a positive number",
        error: true,
        success: false,
      });
    }

    const shouldRecordPayment = Boolean(recordPayment && recordPayment.paymentMethod);
    if (shouldRecordPayment && !PAYMENT_METHODS.includes(recordPayment.paymentMethod)) {
      return res.status(400).json({
        message: "Invalid payment method",
        error: true,
        success: false,
      });
    }

    // Base price and feature prices are never trusted from the request body —
    // both are re-derived server-side from their source collections.
    const basePriceEntry = await categoryBasePriceModel.findOne({ category }).lean();
    const basePrice = basePriceEntry?.basePrice || 0;

    const requestedIds = Array.isArray(requestedFeatureIds)
      ? requestedFeatureIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];
    const featureDocs = requestedIds.length
      ? await productModel
          .find({ _id: { $in: requestedIds }, category: FEATURE_UPGRADE_CATEGORY })
          .select("serviceName sellingPrice price")
          .lean()
      : [];

    const clientProjectFeatures = featureDocs.map((feature) => ({
      featureId: feature._id,
      name: feature.serviceName,
      price: feature.sellingPrice || feature.price || 0,
    }));
    const featuresTotal = clientProjectFeatures.reduce((sum, feature) => sum + (feature.price || 0), 0);
    const referenceTotal = basePrice + featuresTotal;

    const project = new productModel({
      serviceName: CATEGORY_LABELS[category],
      category,
      startingNodeTitle: startingNodeTitle.trim(),
      totalPages: totalPages || undefined,
      price: referenceTotal,
      sellingPrice: finalPrice,
      clientProjectFeatures,
      isHidden: true,
      isCustomClientProject: true,
    });

    await project.save();

    const isPartialPayment = paymentType === "partial";
    const orderData = {
      userId: customerId,
      productId: project._id,
      price: finalPrice,
      totalAmount: finalPrice,
      orderVisibility: "approved",
      status: "in_progress",
      isWebsiteProject: true,
      isPartialPayment,
      paidAmount: 0,
      remainingAmount: finalPrice,
      paymentComplete: false,
    };

    if (isPartialPayment) {
      orderData.installments = buildInstallments(finalPrice, installmentCount);
    }

    const order = new orderModel(orderData);

    initializeProjectTimeline({
      order,
      startingNodeTitle: startingNodeTitle.trim(),
      actorId: req.userId,
    });

    await order.save();

    const lineItems = [
      { name: `${CATEGORY_LABELS[category]} (Base)`, price: basePrice },
      ...clientProjectFeatures.map((feature) => ({ name: feature.name, price: feature.price })),
    ];

    const invoiceDate = new Date();
    const createdInvoices = [];
    if (isPartialPayment) {
      // Sequential, not Promise.all — generateInvoiceNumber() reads the last invoice
      // number and would race if multiple installments requested one concurrently.
      for (const installment of order.installments) {
        const invoiceNumber = await generateInvoiceNumber();
        const dueDate = installment.dueDate || invoiceDate;
        const invoice = await invoiceModel.create({
          userId: customerId,
          orderId: order._id,
          invoiceNumber,
          invoiceType: "project",
          amount: installment.amount,
          status: "unpaid",
          invoiceDate,
          dueDate,
          installmentNumber: installment.installmentNumber,
          lineItems,
        });
        createdInvoices.push(invoice);
      }
    } else {
      const invoiceNumber = await generateInvoiceNumber();
      const invoice = await invoiceModel.create({
        userId: customerId,
        orderId: order._id,
        invoiceNumber,
        invoiceType: "project",
        amount: finalPrice,
        status: "unpaid",
        invoiceDate,
        dueDate: invoiceDate,
        lineItems,
      });
      createdInvoices.push(invoice);
    }

    // Only the first invoice (full amount for one-time, or installment #1 for partial)
    // can be recorded paid at creation time — matches the "Payment Settings" step, which
    // only ever asks for the first-due amount, never later installments in advance.
    if (shouldRecordPayment && createdInvoices.length > 0) {
      await markProjectInvoicePaid({
        invoice: createdInvoices[0],
        customerId,
        paymentMethod: recordPayment.paymentMethod,
        transactionReference: recordPayment.transactionReference,
        notes: recordPayment.notes,
        actorId: req.userId,
      });

      if (!isPartialPayment) {
        order.paidAmount = finalPrice;
        order.remainingAmount = 0;
        order.paymentComplete = true;
        await order.save();
      } else {
        order.installments[0].paid = true;
        order.installments[0].paymentStatus = "none";
        order.installments[0].paidDate = new Date();
        order.paidAmount = order.installments[0].amount;
        order.remainingAmount = finalPrice - order.installments[0].amount;
        order.currentInstallment = 2;
        await order.save();
      }
    }

    return res.status(201).json({
      message: "Project created successfully",
      success: true,
      error: false,
      data: order,
    });
  } catch (error) {
    console.error("Error creating project for client:", error);
    return res.status(500).json({
      message: error.message || "Failed to create project for client",
      error: true,
      success: false,
    });
  }
};

module.exports = adminCreateProjectOrderController;
