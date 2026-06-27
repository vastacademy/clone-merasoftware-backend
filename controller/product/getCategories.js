const categoryModel = require("../../models/categoryModel")

const getCategoryController = async (req, res) => {
    try {
        // Only get active categories
        const allCategories = await categoryModel.find()
            .sort({ order: 1 })
        
        console.log("Sending categories:", allCategories); // Debug log
        
        res.json({
            message: "All Categories",
            success: true,
            error: false,
            data: allCategories
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = getCategoryController