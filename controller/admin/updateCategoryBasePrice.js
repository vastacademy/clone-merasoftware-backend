const categoryBasePriceModel = require("../../models/categoryBasePriceModel");

const PROJECT_CATEGORIES = [
  "standard_websites",
  "dynamic_websites",
  "cloud_software_development",
  "app_development",
];

const updateCategoryBasePriceController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { category, basePrice, description, startingNodeTitle } = req.body;

    if (!PROJECT_CATEGORIES.includes(category)) {
      return res.status(400).json({
        message: "Invalid category",
        error: true,
        success: false,
      });
    }

    const numericBasePrice = Number(basePrice);
    if (!Number.isFinite(numericBasePrice) || numericBasePrice < 0) {
      return res.status(400).json({
        message: "Base price must be a non-negative number",
        error: true,
        success: false,
      });
    }

    const updated = await categoryBasePriceModel.findOneAndUpdate(
      { category },
      {
        category,
        basePrice: numericBasePrice,
        description: description || "",
        startingNodeTitle: (startingNodeTitle || "").trim(),
      },
      { new: true, upsert: true }
    );

    return res.json({
      message: "Category base price saved",
      success: true,
      error: false,
      data: updated,
    });
  } catch (error) {
    console.error("Error updating category base price:", error);
    return res.status(500).json({
      message: error.message || "Failed to update category base price",
      error: true,
      success: false,
    });
  }
};

module.exports = updateCategoryBasePriceController;
