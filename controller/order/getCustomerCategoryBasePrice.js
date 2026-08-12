const categoryBasePriceModel = require("../../models/categoryBasePriceModel");

// Customer-safe, read-only base price for a single project category.
// The admin endpoint (getCategoryBasePrices.js) is admin-guarded and returns ALL
// categories for the admin config table; the customize form (StartNewWebsiteCustomize.js)
// only needs the base price for the one category it is estimating, and any authenticated
// customer may read it — so this is a separate, minimal, admin-flow-untouched endpoint.
// SSOT: reads the same categoryBasePriceModel the backend price-derivation uses.

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const getCustomerCategoryBasePrice = async (req, res) => {
  try {
    const { category } = req.query;

    if (!category || !PROJECT_CATEGORIES.includes(category)) {
      return res.status(400).json({
        message: "Valid project category is required",
        error: true,
        success: false,
      });
    }

    const entry = await categoryBasePriceModel.findOne({ category }).lean();
    const basePrice = entry?.basePrice || 0;

    return res.json({
      message: "Category base price",
      success: true,
      error: false,
      data: { category, basePrice },
    });
  } catch (error) {
    console.error("Error fetching customer category base price:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch category base price",
      error: true,
      success: false,
    });
  }
};

module.exports = getCustomerCategoryBasePrice;
