const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const buildOrderDeletePlan = require("../../helpers/orderDeletePlan");

const scanDeleteOrderController = async (req, res) => {
  try {
    const user = await userModel.findById(req.userId).select("roles");
    if (req.userRole !== "admin" || !user?.roles?.includes("admin")) {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: "Valid orderId is required",
        error: true,
        success: false,
      });
    }

    const plan = await buildOrderDeletePlan(orderId);
    if (!plan.hasAnyDeleteableRecord) {
      return res.status(404).json({
        message: "Delete target not found",
        error: true,
        success: false,
      });
    }

    return res.status(200).json({
      message: "Delete scan completed successfully",
      success: true,
      error: false,
      data: plan,
    });
  } catch (error) {
    console.error("Error scanning project delete plan:", error);
    return res.status(500).json({
      message: error.message || "Failed to scan project delete plan",
      error: true,
      success: false,
    });
  }
};

module.exports = scanDeleteOrderController;
