const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
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
      .select("name email phone status walletBalance createdAt updatedAt")
      .lean();
    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
        error: true,
        success: false,
      });
    }

    const [orders, transactions, invoices, updateRequestCounts] = await Promise.all([
      applyOrderSummary(orderModel.find({ userId: customerObjectId }).sort({ createdAt: -1 })),
      transactionModel
        .find({ userId: customerObjectId })
        .select("transactionId upiTransactionId amount status type sourceType paymentMethod invoiceId orderId date createdAt rejectionReason")
        .sort({ createdAt: -1 }),
      monthlyInvoiceModel
        .find({ userId: customerObjectId })
        .select("orderId invoiceNumber amount status invoiceDate dueDate paidDate paymentMethod transactionReference createdAt")
        .populate("orderId", "productId")
        .populate({ path: "orderId", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
      updateRequestModel.aggregate([
        { $match: { userId: customerObjectId } },
        { $group: { _id: null, total: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } } } },
      ]),
    ]);

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
        transactions,
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
