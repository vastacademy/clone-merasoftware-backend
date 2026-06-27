const orderModel = require("../../models/orderProductModel");
const uploadProductPermission = require("../../helpers/permission");

const getUpdatePlansController = async (req, res) => {
  try {
    const adminId = req.userId;

    // Check admin permission
    const isAdmin = await uploadProductPermission(adminId);
    if (!isAdmin) {
      return res.status(403).json({
        message: "Only admin can view plans",
        error: true,
        success: false
      });
    }

    // Fetch all update plans with proper filtering
    const plans = await orderModel.find()
      .populate('userId', 'name email')
      .populate('productId', 'serviceName category updateCount isMonthlyLimitedPlan isMonthlyRenewablePlan monthlyUpdateLimit')
      .sort({ createdAt: -1 })
      .then(orders => {
        // Filter for website_updates category after population
        return orders.filter(order => order.productId?.category === 'website_updates');
      });

    res.status(200).json({
      message: "Plans fetched successfully",
      success: true,
      error: false,
      data: plans
    });
  } catch (error) {
    console.error('Error in getUpdatePlansController:', error);
    res.status(500).json({
      message: error.message || "Internal server error",
      error: true,
      success: false
    });
  }
};

module.exports = getUpdatePlansController;
