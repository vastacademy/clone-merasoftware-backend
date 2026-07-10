const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const transactionModel = require("../../models/transactionModel");

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

    const customer = await userModel.findById(customerObjectId);
    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
        error: true,
        success: false,
      });
    }

    const [orders, transactions, invoices, updateRequests, updatePlans] = await Promise.all([
      orderModel
        .find({ userId: customerObjectId })
        .populate("userId", "name email")
        .populate(
          "productId",
          "serviceName category totalPages validityPeriod updateCount isWebsiteUpdate isMonthlyRenewablePlan yearlyPlanDuration monthlyRenewalCost isUnlimitedUpdates isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice"
        )
        .populate("assignedDeveloper", "name designation avatar status")
        .sort({ createdAt: -1 }),
      transactionModel
        .find({ userId: customerObjectId })
        .populate("userId", "name email")
        .populate("productId", "serviceName")
        .populate("verifiedBy", "name email")
        .sort({ createdAt: -1 }),
      monthlyInvoiceModel
        .find({ userId: customerObjectId })
        .populate("userId", "name email")
        .populate("orderId", "productId totalPrice price status projectProgress")
        .sort({ createdAt: -1 }),
      updateRequestModel
        .find({ userId: customerObjectId })
        .populate("updatePlanId", "productId")
        .populate({
          path: "updatePlanId",
          populate: {
            path: "productId",
            select: "serviceName",
          },
        })
        .populate("assignedDeveloper", "name designation avatar status")
        .sort({ createdAt: -1 }),
      orderModel
        .find({ userId: customerObjectId, "productId.isWebsiteUpdate": true })
        .populate(
          "productId",
          "serviceName validityPeriod updateCount isMonthlyRenewablePlan yearlyPlanDuration monthlyRenewalCost isUnlimitedUpdates"
        )
        .sort({ createdAt: -1 }),
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
    const activeUpdatePlans = updatePlans.filter((plan) => plan?.isActive !== false && !plan?.isExpired);

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
        updates: updateRequests,
        plans: updatePlans,
        summary: {
          totalOrders: orders.length,
          activeOrders: activeOrders.length,
          pendingOrders: pendingOrders.length,
          completedOrders: completedOrders.length,
          rejectedOrders: rejectedOrders.length,
          activePlans: activeUpdatePlans.length,
          pendingUpdates: updateRequests.filter((update) => update?.status === "pending").length,
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
