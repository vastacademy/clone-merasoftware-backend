const userModel = require("../../models/userModel");
const transactionModel = require("../../models/transactionModel");
const orderProductModel = require("../../models/orderProductModel");
const { sendPurchaseConfirmationEmail, sendMonthlyLimitedPlanActivationEmail, generateInvoicePdf } = require("../../helpers/emailService");
const { createPurchaseNotification } = require("../../helpers/notificationService");

const deductWalletController = async (req, res) => {
    try {
        const { amount, isInstallmentPayment = false, orderId } = req.body;
        if (!amount) {
            throw new Error("Please provide amount");
        }
        
        const user = await userModel.findById(req.userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Check if user has sufficient balance
        if (user.walletBalance < amount) {
            throw new Error("Insufficient wallet balance");
        }
        
        // Deduct amount
        user.walletBalance -= Number(amount);
        await user.save();
        
        // Create transaction record
        const transaction = new transactionModel({
            userId: req.userId,
            amount: -amount, // Negative amount indicates deduction
            type: 'payment',
            status: 'completed',
            transactionId: 'PAY-' + Date.now(),
            description: isInstallmentPayment ? 'Installment payment' : 'Payment for order',
            isInstallmentPayment: isInstallmentPayment,
            orderId: orderId
        });
        
        await transaction.save();

        // If there's an order ID, find it and send purchase confirmation
        if (orderId) {
            try {
                // Find the order and populate necessary fields
                const order = await orderProductModel.findById(orderId)
                    .populate('userId', 'name email')
                    .populate('productId', 'serviceName category totalPages validityPeriod updateCount isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice');
                
                if (order) {
                    // For normal orders or first installment of partial payment
                    const paymentDetails = {
                        method: 'Wallet',
                        transactionId: transaction.transactionId,
                        date: new Date()
                    };
                    
                    // Generate invoice PDF
                    const invoiceBuffer = await generateInvoicePdf(order, paymentDetails);
                    paymentDetails.invoiceBuffer = invoiceBuffer;
                    
                    // Send appropriate email based on plan type
                    if (order.productId?.isMonthlyLimitedPlan) {
                        // Send special activation email for Monthly Limited Plan
                        await sendMonthlyLimitedPlanActivationEmail(order, paymentDetails);
                    } else {
                        // Send standard purchase confirmation email
                        await sendPurchaseConfirmationEmail(order, paymentDetails);
                    }
                    
                    // Create in-app notification
                    await createPurchaseNotification(order);
                    
                    console.log('Purchase confirmation email and notification sent for order:', order._id);
                }
            } catch (error) {
                console.error('Error sending purchase confirmation:', error);
                // Continue execution even if notification/email fails
            }
        }
        
        res.status(200).json({
            message: "Payment successful",
            data: {
                remainingBalance: user.walletBalance,
                transactionId: transaction.transactionId
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

module.exports = deductWalletController;