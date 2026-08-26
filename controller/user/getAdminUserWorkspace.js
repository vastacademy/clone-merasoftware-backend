const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const invoiceModel = require("../../models/invoiceModel");
const transactionModel = require("../../models/transactionModel");
const { applyOrderSummary } = require("../../helpers/orderSummary");

const getAdminUserWorkspace = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const customerId = req.query.customerId;
    if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
      return res.status(400).json({
        message: "Valid customerId is required",
        error: true,
        success: false,
      });
    }

    const customerObjectId = new mongoose.Types.ObjectId(customerId);

    const customer = await userModel
      .findById(customerObjectId)
      .select("name email phone status walletBalance createdAt updatedAt isGuest")
      .lean();
    // Guests are demo-only accounts (see guestLogin.js) and must never surface
    // in any admin workspace — same boundary getAdminClients.js already
    // enforces for the client list, applied here for the per-client detail
    // view too, since this endpoint takes customerId directly and has no
    // list-level filter to rely on.
    if (!customer || customer.isGuest) {
      return res.status(404).json({
        message: "Customer not found",
        error: true,
        success: false,
      });
    }

    const [orders, rawOrderRefs, transactions, monthlyInvoices, projectInvoices, updateRequestCounts] = await Promise.all([
      applyOrderSummary(orderModel.find({ userId: customerObjectId }).sort({ createdAt: -1 })),
      // Raw (unpopulated) orderId snapshot — used below to tell "no project linked" (e.g. wallet
      // deposit) apart from "project was deleted" (orderId was set but populate resolves to
      // null because the referenced order document no longer exists).
      Promise.all([
        transactionModel.find({ userId: customerObjectId }).select("orderId").lean(),
        monthlyInvoiceModel.find({ userId: customerObjectId }).select("orderId").lean(),
        invoiceModel.find({ userId: customerObjectId }).select("orderId").lean(),
      ]).then(([txnRefs, monthlyRefs, projectRefs]) => {
        const map = new Map();
        [...txnRefs, ...monthlyRefs, ...projectRefs].forEach((doc) => {
          if (doc.orderId) map.set(String(doc._id), String(doc.orderId));
        });
        return map;
      }),
      transactionModel
        .find({ userId: customerObjectId })
        .select("transactionId upiTransactionId amount status type sourceType paymentMethod invoiceId orderId installmentNumber date createdAt rejectionReason")
        .populate({ path: "orderId", select: "productId projectSnapshot servicePlanSnapshot orderItems", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
      monthlyInvoiceModel
        .find({ userId: customerObjectId })
        .select("orderId invoiceNumber amount status invoiceDate dueDate paidDate paymentMethod transactionReference createdAt")
        .populate({ path: "orderId", select: "productId projectSnapshot servicePlanSnapshot orderItems", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
      invoiceModel
        .find({ userId: customerObjectId })
        .select("orderId invoiceNumber invoiceType amount amountPaid status invoiceDate dueDate paidDate installmentNumber lineItems paymentMethod transactionReference createdAt updatedAt deletedProjectName deletedProjectType")
        .populate({ path: "orderId", select: "productId projectSnapshot servicePlanSnapshot orderItems", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
      updateRequestModel.aggregate([
        { $match: { userId: customerObjectId } },
        { $group: { _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } } } },
      ]),
    ]);

    const markOrderDeleted = (doc) => {
      const plain = doc.toObject();
      const rawOrderId = rawOrderRefs.get(String(doc._id)) || null;
      plain.orderDeleted = Boolean(rawOrderId) && !plain.orderId;
      // Deleted orders resolve to null via populate, so the frontend needs the raw id back
      // (as a plain string, not a live reference) to group same-deleted-project records together.
      if (plain.orderDeleted) plain.orderId = rawOrderId;
      return plain;
    };

    const transactionsWithDeletedFlag = transactions.map(markOrderDeleted);
    const monthlyInvoicesWithDeletedFlag = monthlyInvoices.map(markOrderDeleted);
    const projectInvoicesWithDeletedFlag = projectInvoices.map(markOrderDeleted);

    const invoices = [...monthlyInvoicesWithDeletedFlag, ...projectInvoicesWithDeletedFlag].sort(
      (a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate)
    );

    const isCompletedOrder = (order) =>
      (order?.projectProgress || 0) >= 100 ||
      order?.currentPhase === "completed" ||
      order?.status === "completed";

    const isRejectedOrder = (order) =>
      order?.orderVisibility === "payment-rejected" ||
      order?.status === "rejected" ||
      order?.status === "cancelled" ||
      order?.status === "canceled";

    const isPendingOrder = (order) =>
      order?.orderVisibility === "pending-approval" ||
      order?.status === "pending";

    const isActiveOrder = (order) =>
      !isPendingOrder(order) && !isRejectedOrder(order) && !isCompletedOrder(order);

    const activeOrders = orders.filter(isActiveOrder);
    const pendingOrders = orders.filter(isPendingOrder);
    const completedOrders = orders.filter(isCompletedOrder);
    const rejectedOrders = orders.filter(isRejectedOrder);
    const updateCount = updateRequestCounts[0]?.total || 0;
    const pendingUpdates = updateRequestCounts[0]?.pending || 0;

    return res.status(200).json({
      message: "Customer workspace data fetched successfully",
      success: true,
      error: false,
      data: {
        customer,
        orders,
        renewals: [],
        transactions: transactionsWithDeletedFlag,
        invoices,
        updates: [],
        plans: [],
        summary: {
          totalOrders: orders.length,
          activeOrders: activeOrders.length,
          pendingOrders: pendingOrders.length,
          completedOrders: completedOrders.length,
          rejectedOrders: rejectedOrders.length,
          activePlans: orders.filter((order) => order?.productId?.isWebsiteUpdate && order?.isActive !== false).length,
          updateCount,
          pendingUpdates,
          walletBalance: customer.walletBalance || 0,
          invoiceCount: invoices.length,
          transactionCount: transactions.length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching admin customer workspace:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch customer workspace",
      success: false,
      error: true,
    });
  }
};

module.exports = getAdminUserWorkspace;
