const productModel = require("../../models/productModel");

const getAllProductsController = async (req, res) => {
  try {
    // Retired plans are excluded unless explicitly requested, so they never
    // reappear in pickers that use this endpoint.
    const includeRetired = String(req.query?.includeRetired) === "true";
    const allProducts = await productModel
      .find(includeRetired ? {} : { retiredAt: null })
      .sort({ createdAt: -1 });

    res.json({
      message: "All Products",
      success: true,
      error: false,
      data: allProducts,
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
};

module.exports = getAllProductsController;