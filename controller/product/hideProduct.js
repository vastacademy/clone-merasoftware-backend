const uploadProductPermission = require("../../helpers/permission");
const productModel = require("../../models/productModel");

async function hideProductController(req, res) {
    try {
        if (!uploadProductPermission(req.userId)) {
            throw new Error("Permission denied");
        }

        const { _id } = req.body;
        if (!_id) {
            throw new Error("Product ID is required");
        }

        const updatedProduct = await productModel.findByIdAndUpdate(
            _id,
            { isHidden: true },
            { new: true }
        );

        if (!updatedProduct) {
            throw new Error("Product not found");
        }

        res.json({
            message: "Product hidden successfully",
            success: true,
            error: false,
            data: updatedProduct,
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

module.exports = hideProductController;
