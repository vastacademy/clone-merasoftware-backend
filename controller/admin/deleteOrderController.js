const Order = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const Transaction = require("../../models/transactionModel");
const uploadProductPermission = require("../../helpers/permission");

const adminDeleteOrderController = async (req, res) => {
    try {
        const { orderId } = req.params;
        
        // Verify admin permissions
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can delete orders");
        }

        // Find the order to be deleted
        const order = await Order.findById(orderId);
        if (!order) {
            throw new Error("Order not found");
        }

        // Calculate refund amount
        const refundAmount = order.price * order.quantity;
        
        // Get user information
        const user = await userModel.findById(order.userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Process refund to user's wallet
        user.walletBalance += Number(refundAmount);
        await user.save();

        // Create transaction record for the refund
        await Transaction.create({
            userId: order.userId,
            amount: refundAmount,
            type: 'refund',
            description: `Refund for order #${order._id.toString().substring(order._id.toString().length - 6)}`,
            relatedOrderId: order._id,
            status: 'completed'
        });
        
        // Delete the order
        await Order.findByIdAndDelete(orderId);

        res.status(200).json({
            message: "Order deleted and amount refunded successfully",
            data: {
                refundedAmount: refundAmount,
                userCurrentBalance: user.walletBalance
            },
            success: true,
            error: false
        });
    } catch (err) {
        console.error("Error in adminDeleteOrder:", err);
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = adminDeleteOrderController;