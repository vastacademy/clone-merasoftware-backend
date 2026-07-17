const orderProductModel = require("../../models/orderProductModel")
const mongoose = require('mongoose');
const { applyOrderSummary } = require("../../helpers/orderSummary");

const getUserOrders = async (req, res) => {
    try {
        // Get the current user's ID from req.userId (which should be set by your auth middleware)
        const userId = req.userId;

        // Convert userId string to MongoDB ObjectId for proper matching
        let userObjectId;
        try {
            userObjectId = mongoose.Types.ObjectId(userId);
        } catch (e) {
            userObjectId = userId; // Fallback if already ObjectId
        }

        // Add userId filter to only get orders for the current user
        const orders = await applyOrderSummary(
            orderProductModel.find({ userId: userObjectId }).sort({ createdAt: -1 })
        );

        console.log('Total projects found:', orders.length);
        console.log('Sample project:', orders[0]);

        // Debug yearly plans (renewable & limited)
        const yearlyPlans = orders.filter(order =>
            order.productId?.isMonthlyRenewablePlan || order.productId?.isMonthlyLimitedPlan
        );
        if (yearlyPlans.length > 0) {
            console.log('Found yearly plans:', yearlyPlans.length);
            console.log('Yearly plan sample:', {
                id: yearlyPlans[0]._id,
                isMonthlyRenewablePlan: yearlyPlans[0].productId?.isMonthlyRenewablePlan,
                isMonthlyLimitedPlan: yearlyPlans[0].productId?.isMonthlyLimitedPlan,
                yearlyPlanDuration: yearlyPlans[0].productId?.yearlyPlanDuration,
                monthlyRenewalCost: yearlyPlans[0].productId?.monthlyRenewalCost,
                monthlyUpdateLimit: yearlyPlans[0].productId?.monthlyUpdateLimit,
                monthlyRenewalPrice: yearlyPlans[0].productId?.monthlyRenewalPrice,
                totalYearlyDaysRemaining: yearlyPlans[0].totalYearlyDaysRemaining,
                currentMonthExpiryDate: yearlyPlans[0].currentMonthExpiryDate,
                currentMonthUpdatesUsed: yearlyPlans[0].currentMonthUpdatesUsed,
                currentMonthUpdatesLimit: yearlyPlans[0].currentMonthUpdatesLimit,
                currentMonthUpdatesRemaining: yearlyPlans[0].currentMonthUpdatesRemaining
            });
        }
        
        res.status(200).json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = getUserOrders
