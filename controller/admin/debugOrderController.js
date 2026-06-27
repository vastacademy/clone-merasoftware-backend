const orderProductModel = require('../../models/orderProductModel');

// TEMPORARY CONTROLLER - FOR DEBUGGING
// DELETE THIS AFTER TESTING IS COMPLETE

const debugOrderController = async (req, res) => {
    try {
        console.log('🔍 Debugging orders for auto-renewal...');

        // Find all orders with currentMonthExpiryDate
        const allOrders = await orderProductModel.find({
            currentMonthExpiryDate: { $exists: true }
        }).populate('productId').populate('userId', 'name email');

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        console.log('📅 Today:', today.toISOString());
        console.log('📅 Tomorrow:', tomorrow.toISOString());

        const ordersData = allOrders.map(order => {
            const expiryDate = new Date(order.currentMonthExpiryDate);
            const isExpiringToday = expiryDate >= today && expiryDate < tomorrow;

            return {
                orderId: order._id,
                user: order.userId?.name || 'N/A',
                productName: order.productId?.serviceName || 'N/A',
                isMonthlyLimitedPlan: order.productId?.isMonthlyLimitedPlan || false,
                currentMonthExpiryDate: order.currentMonthExpiryDate,
                expiryDateFormatted: expiryDate.toISOString(),
                isExpiringToday: isExpiringToday,
                totalYearlyDaysRemaining: order.totalYearlyDaysRemaining,
                currentMonthUpdatesRemaining: order.currentMonthUpdatesRemaining,
                eligibleForAutoRenewal:
                    order.productId?.isMonthlyLimitedPlan === true &&
                    isExpiringToday &&
                    order.totalYearlyDaysRemaining > 0
            };
        });

        const eligibleOrders = ordersData.filter(o => o.eligibleForAutoRenewal);

        res.status(200).json({
            success: true,
            message: 'Debug information',
            data: {
                today: today.toISOString(),
                tomorrow: tomorrow.toISOString(),
                totalOrders: ordersData.length,
                eligibleForRenewal: eligibleOrders.length,
                orders: ordersData,
                eligibleOrders: eligibleOrders
            }
        });
    } catch (error) {
        console.error('Error in debug:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            error: error
        });
    }
};

module.exports = debugOrderController;
