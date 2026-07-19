const productModel = require("../../models/productModel");

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const getAdminProjectProductsController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const projects = await productModel
      .find({ category: { $in: PROJECT_CATEGORIES } })
      .select("_id serviceName category startingNodeTitle isHidden createdAt updatedAt")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      message: "Admin project products",
      success: true,
      error: false,
      data: projects,
    });
  } catch (error) {
    console.error("Error fetching admin project products:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch project products",
      error: true,
      success: false,
    });
  }
};

module.exports = getAdminProjectProductsController;
