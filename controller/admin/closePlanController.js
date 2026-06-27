const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const uploadProductPermission = require("../../helpers/permission");
const { sendPlanClosureEmailToCustomer, sendPlanClosureEmailToAdmin } = require("../../helpers/emailService");

const closePlanController = async (req, res) => {
  try {
    const { orderId, closureReason } = req.body;
    const adminId = req.userId;

    // Validate required fields
    if (!orderId || !closureReason) {
      return res.status(400).json({
        message: "Order ID and closure reason are required",
        error: true,
        success: false
      });
    }

    // Check admin permission
    const isAdmin = await uploadProductPermission(adminId);
    if (!isAdmin) {
      return res.status(403).json({
        message: "Only admin can close plans",
        error: true,
        success: false
      });
    }

    // Find and populate order
    const order = await orderModel.findById(orderId)
      .populate('userId', 'name email')
      .populate('productId', 'serviceName category updateCount isMonthlyLimitedPlan isMonthlyRenewablePlan');

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false
      });
    }

    // Validate it's an update plan
    if (order.productId.category !== 'website_updates') {
      return res.status(400).json({
        message: "This is not an update plan",
        error: true,
        success: false
      });
    }

    // Check if already closed
    if (order.planStatus === 'closed') {
      return res.status(400).json({
        message: "This plan is already closed",
        error: true,
        success: false
      });
    }

    // Get admin name
    const admin = await userModel.findById(adminId, 'name');
    const adminName = admin?.name || 'Admin';

    // Update order
    order.planStatus = 'closed';
    order.closureReason = closureReason;
    order.closedAt = new Date();
    order.closedBy = adminId;
    await order.save();

    // Send emails
    try {
      await sendPlanClosureEmailToCustomer(order, closureReason, order.closedAt);
      console.log('Plan closure email sent to customer');
    } catch (emailError) {
      console.error('Error sending customer email:', emailError);
      // Continue even if email fails
    }

    try {
      await sendPlanClosureEmailToAdmin(order, closureReason, adminName, order.closedAt);
      console.log('Plan closure email sent to admin');
    } catch (emailError) {
      console.error('Error sending admin email:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      message: "Plan closed successfully",
      success: true,
      error: false,
      data: {
        orderId: order._id,
        planStatus: order.planStatus,
        closedAt: order.closedAt
      }
    });
  } catch (error) {
    console.error('Error in closePlanController:', error);
    res.status(500).json({
      message: error.message || "Internal server error",
      error: true,
      success: false
    });
  }
};

module.exports = closePlanController;
