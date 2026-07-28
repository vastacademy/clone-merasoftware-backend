const productModel = require("../../models/productModel");

const getAdminPlanProductsController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const plans = await productModel
      .find({ category: "website_updates" })
      .select("_id serviceName category isMonthlyRenewablePlan isMonthlyLimitedPlan validityPeriod updateCount isHidden createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      message: "Admin plan products",
      success: true,
      error: false,
      data: plans,
    });
  } catch (error) {
    console.error("Error fetching admin plan products:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch plan products",
      error: true,
      success: false,
    });
  }
};

module.exports = getAdminPlanProductsController;
