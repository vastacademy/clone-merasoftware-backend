const uploadProductPermission = require("../../helpers/permission");
const orderModel = require("../../models/orderProductModel");
const productModel = require("../../models/productModel"); // Add this import

async function adminUpdatePlansController(req, res) {
    try {
        // Check permission
        const sessionUserId = req.userId;
        if (!await uploadProductPermission(sessionUserId)) {
            throw new Error("Permission denied");
        }

        // First, find all products with category 'website_updates'
        const updateProducts = await productModel.find({ 
            category: 'website_updates' 
        });
        
        // Get their IDs
        const updateProductIds = updateProducts.map(product => product._id);
        
        // Now find orders with these product IDs
        const updatePlans = await orderModel.find({
            productId: { $in: updateProductIds }
        })
        .populate('userId', 'name email')
        .populate('productId')
        .sort({ createdAt: -1 }); // Sort by most recent first

        // Calculate validity and active status for each plan
        const processedPlans = updatePlans.map(plan => {
            // Ensure the plan has the required fields
            if (!plan.productId || !plan.productId.validityPeriod) {
                return plan;
            }

            // Calculate if the plan is still within its validity period
            const validityInDays = plan.productId.validityPeriod;
            const startDate = new Date(plan.createdAt);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + validityInDays);
           
            const today = new Date();
            const isWithinValidity = today <= endDate;
           
            // If plan has expired but is still marked as active, update it
            if (!isWithinValidity && plan.isActive) {
                plan.isActive = false;
                plan.save().catch(err => console.error("Error saving plan status:", err)); // Save the updated status
            }
            return plan;
        });

        res.status(200).json({
            message: "Update plans fetched successfully",
            error: false,
            success: true,
            data: processedPlans
        });
    } catch (err) {
        console.error("Error in adminUpdatePlansController:", err);
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = adminUpdatePlansController;