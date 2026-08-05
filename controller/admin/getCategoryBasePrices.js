const categoryBasePriceModel = require("../../models/categoryBasePriceModel");

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const getCategoryBasePricesController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const existing = await categoryBasePriceModel.find().lean();
    const existingByCategory = new Map(existing.map((entry) => [entry.category, entry]));

    const data = PROJECT_CATEGORIES.map((category) => (
      existingByCategory.get(category) || { category, basePrice: 0, description: "" }
    ));

    return res.json({
      message: "Category base prices",
      success: true,
      error: false,
      data,
    });
  } catch (error) {
    console.error("Error fetching category base prices:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch category base prices",
      error: true,
      success: false,
    });
  }
};

module.exports = getCategoryBasePricesController;
