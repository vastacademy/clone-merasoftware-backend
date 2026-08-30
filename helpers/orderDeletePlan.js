const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const updateRequestModel = require("../models/updateRequestModel");
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel");
const transactionModel = require("../models/transactionModel");
const partnerCommissionModel = require("../models/partnerCommissionModel");

const collectDriveFileIds = (requests = []) => {
  const fileIds = new Set();

  for (const request of requests) {
    for (const file of request?.files || []) {
      if (file?.driveFileId) {
        fileIds.add(String(file.driveFileId));
      }
    }
  }

  return [...fileIds];
};

const createSection = ({ key, label, count, required = true, present = count > 0, source, description, derived = false }) => ({
  key,
  label,
  count,
  required,
  present,
  source,
  description,
  derived,
});

const buildOrderDeletePlan = async (orderId) => {
  const orderObjectId = new mongoose.Types.ObjectId(orderId);

  const [order, relatedUpdateRequests, relatedInvoices, relatedTransactions, relatedCommissions] =
    await Promise.all([
      orderModel.findById(orderObjectId).populate("productId", "serviceName category isWebsiteUpdate"),
      updateRequestModel
        .find({ updatePlanId: orderObjectId })
        .populate({
          path: "updatePlanId",
          populate: {
            path: "productId",
            select: "serviceName category isWebsiteUpdate",
          },
        }),
      monthlyInvoiceModel.find({ orderId: orderObjectId }),
      transactionModel.find({ orderId: orderObjectId }),
      partnerCommissionModel.find({ orderId: orderObjectId }),
    ]);

  const driveFileIds = collectDriveFileIds(relatedUpdateRequests);
  const relatedProduct = order?.productId || relatedUpdateRequests?.[0]?.updatePlanId?.productId || null;
  // Same name-priority as frontend/src/helpers/orderPresentation.js's getOrderDisplayName —
  // a custom client project (no catalog product link) only has projectSnapshot.displayName.
  const serviceName =
    order?.projectSnapshot?.displayName ||
    relatedProduct?.serviceName ||
    order?.servicePlanSnapshot?.serviceName ||
    (order?.orderItems || []).find((item) => item.type === "main")?.name ||
    order?.orderItems?.[0]?.name ||
    "Project";
  // Same plan/project split as frontend/src/helpers/orderType.js's PLAN_CATEGORIES —
  // isWebsiteProject is the order-level SSOT set at creation; category is only a fallback
  // for the rare order missing that field (service_plan category orders are plans too).
  const PLAN_CATEGORIES = new Set(["website_updates", "service_plan"]);
  const isUpdatePlan = order?.isWebsiteProject === undefined
    ? Boolean(relatedProduct?.isWebsiteUpdate || PLAN_CATEGORIES.has(relatedProduct?.category))
    : !order.isWebsiteProject;
  const orderType = isUpdatePlan ? "plan" : "project";

  // Facts that only exist while the order and its transactions are still alive. deleteOrder.js
  // writes these onto the order's invoices before cascading, so the admin "Deleted Projects"
  // tab can still state what was deleted, when it was bought, and how it was paid for.
  const startDate = order?.createdAt || null;
  // Money actually received — a pending or rejected transaction never paid for anything.
  // "deposit" is a wallet recharge, not a payment against this order.
  const paidMethods = [
    ...new Set(
      relatedTransactions
        .filter((txn) => txn.status === "completed" && txn.type !== "deposit" && txn.paymentMethod)
        .map((txn) => String(txn.paymentMethod))
    ),
  ];
  // One method is reported as-is; several different methods across payments read as "combined",
  // the same word transactionModel already uses for a split wallet+UPI payment.
  const paymentMethod =
    paidMethods.length === 1 ? paidMethods[0] : paidMethods.length > 1 ? "combined" : null;

  const sections = [
    createSection({
      key: "order_record",
      label: "Main order record",
      count: order ? 1 : 0,
      required: true,
      present: Boolean(order),
      source: "orderModel",
      description: order
        ? "Primary source record that powers admin and customer views."
        : "Already missing from the order collection.",
    }),
    createSection({
      key: "update_requests",
      label: "Linked update requests",
      count: relatedUpdateRequests.length,
      required: true,
      source: "updateRequestModel",
      description: "Removes update request history and attached file metadata.",
    }),
    createSection({
      key: "monthly_invoices",
      label: "Linked invoices",
      count: relatedInvoices.length,
      required: true,
      source: "monthlyInvoiceModel",
      description: "Removes invoice history tied to this order.",
    }),
    createSection({
      key: "transactions",
      label: "Linked transactions",
      count: relatedTransactions.length,
      required: true,
      source: "transactionModel",
      description: "Removes payment and renewal transactions tied to this order.",
    }),
    createSection({
      key: "partner_commissions",
      label: "Partner commissions",
      count: relatedCommissions.length,
      required: true,
      source: "partnerCommissionModel",
      description: "Removes partner commission records tied to this order.",
    }),
    createSection({
      key: "drive_files",
      label: "Google Drive files",
      count: driveFileIds.length,
      required: true,
      source: "GoogleDriveService",
      description: "Removes uploaded update files from Drive.",
    }),
  ];

  const derivedImpacts = [
    {
      key: "customer_portal_visibility",
      label: "Customer portal visibility",
      description: "This disappears automatically because the customer portal reads the same order source of truth.",
      derived: true,
    },
    {
      key: "admin_workspace_visibility",
      label: "Admin workspace visibility",
      description: "This disappears automatically after the order source record is deleted.",
      derived: true,
    },
  ];

  const requiredSectionKeys = sections.filter((section) => section.present).map((section) => section.key);
  const missingSectionKeys = sections.filter((section) => !section.present).map((section) => section.key);

  return {
    orderId: String(orderId),
    orderPresent: Boolean(order),
    orderType,
    serviceName,
    startDate,
    paymentMethod,
    sections,
    derivedImpacts,
    requiredSectionKeys,
    missingSectionKeys,
    driveFileIds,
    counts: {
      updateRequests: relatedUpdateRequests.length,
      invoices: relatedInvoices.length,
      transactions: relatedTransactions.length,
      commissions: relatedCommissions.length,
      driveFiles: driveFileIds.length,
    },
    hasAnyDeleteableRecord:
      Boolean(order) ||
      relatedUpdateRequests.length > 0 ||
      relatedInvoices.length > 0 ||
      relatedTransactions.length > 0 ||
      relatedCommissions.length > 0 ||
      driveFileIds.length > 0,
  };
};

module.exports = buildOrderDeletePlan;
