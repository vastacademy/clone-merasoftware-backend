const userModel = require("../../models/userModel");
const transactionModel = require("../../models/transactionModel");
const orderModel = require("../../models/orderProductModel");
const uploadProductPermission = require("../../helpers/permission");
// Import the email and notification services
const { 
  sendPaymentRejectionEmail,
  sendWalletRechargeRejectionEmail 
} = require("../../helpers/emailService");
const { 
  createPaymentRejectionNotification,
  createWalletRechargeRejectionNotification 
} = require("../../helpers/notificationService");

const rejectTransactionController = async (req, res) => {
    try {
        const { transactionId, rejectionReason } = req.body;
        
        // Validate required fields
        if (!transactionId || !rejectionReason) {
            throw new Error("Transaction ID and rejection reason are required");
        }
        
        // Check admin permission
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can reject transactions");
        }
        
        // Find the transaction
        const transaction = await transactionModel.findById(transactionId);
        if (!transaction) {
            throw new Error("Transaction not found");
        }
        
        // Check if transaction is already processed
        if (transaction.status !== 'pending') {
            throw new Error("Transaction already processed");
        }
        
        // Find the user for notifications
        const user = await userModel.findById(transaction.userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Update transaction status with rejection reason
        transaction.status = 'failed';
        transaction.verifiedBy = req.userId;
        transaction.rejectionReason = rejectionReason;
        await transaction.save();
        
        // Send notifications based on transaction type
        try {
            if (transaction.type === 'deposit' && !transaction.isInstallmentPayment && !transaction.orderId) {
                // This is a wallet recharge transaction
                console.log(`Processing wallet recharge rejection for transaction ${transaction._id}`);
                
                // Send email notification
                await sendWalletRechargeRejectionEmail(user, transaction, rejectionReason);
                
                // Create in-app notification
                await createWalletRechargeRejectionNotification(user, transaction, rejectionReason);
                
                console.log(`Wallet recharge rejection notifications sent for user ${user._id}`);
            } else if (transaction.isInstallmentPayment || transaction.orderId) {
                // This is an order payment transaction
                console.log(`Processing order payment rejection for transaction ${transaction._id}`);
                
                // Find the related order
                const order = await orderModel.findById(transaction.orderId)
                    .populate('productId', 'serviceName');
                
                if (order) {
                    // Update order visibility status to payment-rejected
                    order.orderVisibility = 'payment-rejected';
                    order.rejectionReason = rejectionReason;
                    await order.save();
                    
                    // Send email notification
                    await sendPaymentRejectionEmail(user, transaction, order, rejectionReason);
                    
                    // Create in-app notification
                    await createPaymentRejectionNotification(user, transaction, order, rejectionReason);
                    
                    console.log(`Order payment rejection notifications sent for order ${order._id}`);
                } else {
                    // Order not found, just send generic notification
                    await sendPaymentRejectionEmail(user, transaction, null, rejectionReason);
                    await createPaymentRejectionNotification(user, transaction, null, rejectionReason);
                }
            }
        } catch (notificationError) {
            console.error('Error sending rejection notifications:', notificationError);
            // Continue processing even if notifications fail
        }
        
        res.status(200).json({
            message: "Transaction rejected",
            data: {
                transactionId: transaction._id,
                status: 'failed',
                reason: rejectionReason
            },
            success: true,
            error: false
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = rejectTransactionController;