const uploadProductPermission = require("../../helpers/permission")
const productModel = require("../../models/productModel")

async function deleteProductController(req, res) {
    try {
        // Check permission
        if (!uploadProductPermission(req.userId)) {
            throw new Error("Permission denied")
        }

        // Get product ID from request
        const { _id } = req.body

        // Delete product from database
        const deletedProduct = await productModel.findByIdAndDelete(_id)

        // If product not found
        if (!deletedProduct) {
            throw new Error("Product not found")
        }

        // Send success response
        res.json({
            message: "Product Deleted Successfully",
            success: true,
            error: false,
            data: deletedProduct
        })

    } catch (err) {
        // Error handling
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = deleteProductController