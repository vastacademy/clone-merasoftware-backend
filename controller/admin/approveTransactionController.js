const userModel = require("../../models/userModel");
const transactionModel = require("../../models/transactionModel");
const orderModel = require("../../models/orderProductModel");
const uploadProductPermission = require("../../helpers/permission");
const { sendPurchaseConfirmationEmail, sendMonthlyLimitedPlanActivationEmail, generateInvoicePdf, sendWalletRechargeConfirmationEmail, sendAdminPurchaseConfirmationEmail } = require("../../helpers/emailService");
const { createPurchaseNotification, createWalletRechargeNotification  } = require("../../helpers/notificationService");
const PartnerCommission = require("../../models/partnerCommissionModel");

// In approveTransactionController.js
const approveTransactionController = async (req, res) => {
    try {
        const { transactionId, userId, skipWalletCredit = false } = req.body;
        // 👆 Add skipWalletCredit parameter to avoid double wallet crediting
       
        // Validate required fields
        if (!transactionId || !userId) {
            throw new Error("Transaction ID and User ID are required");
        }
        
        // Check admin permission
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can approve transactions");
        }
        
        // Find the transaction
        const transaction = await transactionModel.findById(transactionId);
        if (!transaction) {
            throw new Error("Transaction not found");
        }
        
        // Check if transaction is already processed
        if (transaction.status !== 'pending') {
            return res.status(400).json({
                message: `Transaction has already been ${transaction.status}`,
                error: true,
                success: false
            });
        }
        
        // Find the user
        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

         // Find the user who referred
        const referrer = await userModel.findById(transaction.referredBy);
        if (referrer) {
            // Check if this transaction belongs to installment payment and hasn't been credited yet
            if (!transaction.partnerWalletCredited) {
                // Check if this is first order or subsequent order
                const previousApprovedOrders = await orderModel.find({
                    userId: userId,
                    orderVisibility: { $in: ['approved', 'visible'] },
                    _id: { $ne: transaction.orderId }
                });
                
                // Determine commission rate based on order history
                let commissionRate;
                if (previousApprovedOrders.length === 0) {
                    commissionRate = 0.10; // 10% for first order
                } else {
                    commissionRate = 0.05; // 5% for subsequent orders
                }
                
                const referralBonus = transaction.amount * commissionRate;
                referrer.walletBalance += referralBonus; // Add to referrer's wallet
                await referrer.save(); // Save the updated wallet balance

                // Get order details for service name
                const order = await orderModel.findById(transaction.orderId).populate('productId', 'serviceName');
                const customer = await userModel.findById(userId, 'name');
                
                const commissionRecord = new PartnerCommission({
                    partnerId: referrer._id,
                    customerId: userId,
                    customerName: customer.name,
                    orderId: transaction.orderId,
                    transactionId: transaction._id,
                    orderAmount: transaction.amount,
                    commissionAmount: referralBonus,
                    commissionRate: commissionRate,
                    commissionType: previousApprovedOrders.length === 0 ? 'first_purchase' : 'repeat_purchase',
                    serviceName: order?.productId?.serviceName || 'Service',
                    status: 'credited'
                });
                await commissionRecord.save();

                // Mark transaction as credited to partner wallet
                transaction.partnerWalletCredited = true;
                await transaction.save();
                
                console.log(`Applied ${commissionRate * 100}% commission (${referralBonus}) to referrer ${referrer._id} for transaction ${transaction._id}`);
            } else {
                console.log(`Commission already credited for transaction ${transaction._id}`);
            }
        }
        
        // Determine transaction type
        const isInstallmentPayment = 
            transaction.isInstallmentPayment === true || 
            transaction.type === 'payment';
        
        // Check if this is a partial wallet payment (part paid via wallet, part via UPI)
        const isPartialWalletPayment = transaction.isPartialInstallmentPayment === true;
        
        // Track whether to skip wallet credit
        let skipAddingToWallet = skipWalletCredit;
        let orderUpdateMessage = '';
        
       // Update transaction status
       transaction.status = 'completed';
       transaction.verifiedBy = req.userId;
       await transaction.save();

       // Process wallet payments differently from installment payments
       if (transaction.paymentMethod === 'wallet' && transaction.type === 'payment') {
           // This is a wallet payment for an order
           console.log(`Processing wallet payment for order: ${transaction.orderId}`);
           
           // Deduct from wallet ONLY after admin approval
           if (user.walletBalance >= transaction.amount) {
               user.walletBalance -= transaction.amount;
               await user.save();
               console.log(`Deducted ${transaction.amount} from user ${user._id} wallet for order payment`);
           } else {
               console.error(`Insufficient wallet balance for user ${user._id}`);
               throw new Error("Insufficient wallet balance");
           }
           
           // Process order/installment update
           if (transaction.orderId) {
               try {
                   // Find and update the order
                   const order = await orderModel.findById(transaction.orderId);
                   if (order) {
                       // Update order visibility to visible
                       order.orderVisibility = 'visible';
                       
                       // Update installment status if applicable
                       if (order.isPartialPayment && transaction.installmentNumber) {
                           const installmentIndex = order.installments.findIndex(
                               inst => inst.installmentNumber === transaction.installmentNumber
                           );
                           
                           if (installmentIndex !== -1) {
                               order.installments[installmentIndex].paid = true;
                               order.installments[installmentIndex].paidDate = new Date();
                               order.installments[installmentIndex].paymentStatus = 'none';
                           }
                       }
                       
                       await order.save();
                       
                       // Send order confirmation notifications
                       try {
                           const populatedOrder = await orderModel.findById(order._id)
                               .populate('userId', 'name email')
                               .populate('productId', 'serviceName category totalPages validityPeriod updateCount isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice');
                           
                           // Generate payment details for email
                           const paymentDetails = {
                               method: 'Wallet',
                               transactionId: transaction.transactionId,
                               date: new Date()
                           };
                           
                           // Generate invoice PDF
                           const invoiceBuffer = await generateInvoicePdf(populatedOrder, paymentDetails);
                           paymentDetails.invoiceBuffer = invoiceBuffer;

                           // Send appropriate email based on plan type
                           console.log('🔍 DEBUG - Checking plan type for email:');
                           console.log('Product ID:', populatedOrder.productId?._id);
                           console.log('Service Name:', populatedOrder.productId?.serviceName);
                           console.log('isMonthlyLimitedPlan:', populatedOrder.productId?.isMonthlyLimitedPlan);

                           if (populatedOrder.productId?.isMonthlyLimitedPlan) {
                               console.log('✅ Sending MONTHLY LIMITED PLAN activation email');
                               // Send special activation email for Monthly Limited Plan
                               await sendMonthlyLimitedPlanActivationEmail(populatedOrder, paymentDetails);
                           } else {
                               console.log('📧 Sending STANDARD purchase confirmation email');
                               // Send standard purchase confirmation email
                               await sendPurchaseConfirmationEmail(populatedOrder, paymentDetails);
                           }

                           // Send admin purchase confirmation email
                           await sendAdminPurchaseConfirmationEmail(populatedOrder, paymentDetails);

                           // Create in-app notification
                           await createPurchaseNotification(populatedOrder);
                       } catch (notificationError) {
                           console.error('Error sending notifications:', notificationError);
                       }
                   }
               } catch (orderError) {
                   console.error('Error updating order:', orderError);
                   orderUpdateMessage = "Error updating order status, but payment was processed";
               }
           }
           
           // Skip adding to wallet for order payments
           skipAddingToWallet = true;
       } else if (transaction.type === 'payment' && transaction.orderId) {
           // This is a UPI payment for an order
           try {
               // Find and update the order
               const order = await orderModel.findById(transaction.orderId);
               if (order) {
                   // Update order visibility to visible
                   order.orderVisibility = 'visible';
                   
                   // Update installment status if applicable
                   if (order.isPartialPayment && transaction.installmentNumber) {
                       const installmentIndex = order.installments.findIndex(
                           inst => inst.installmentNumber === transaction.installmentNumber
                       );
                       
                       if (installmentIndex !== -1) {
                           order.installments[installmentIndex].paid = true;
                           order.installments[installmentIndex].paidDate = new Date();
                           order.installments[installmentIndex].paymentStatus = 'none';
                           
                           // Update payment tracking
                           if (isPartialWalletPayment) {
                               console.log(`Processing partial wallet+UPI payment. UPI Amount: ${transaction.amount}`);
                               // Only add the UPI portion
                               order.paidAmount = (order.paidAmount || 0) + transaction.amount;
                           } else {
                               // Standard full UPI payment
                               order.paidAmount = (order.paidAmount || 0) + transaction.amount;
                           }
                           
                           order.remainingAmount = order.totalAmount - order.paidAmount;
                       }
                   }
                   
                   await order.save();
                   
                   // Send order confirmation notifications
                   try {
                       const populatedOrder = await orderModel.findById(order._id)
                           .populate('userId', 'name email')
                           .populate('productId', 'serviceName category totalPages validityPeriod updateCount isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice');
                       
                       // Generate payment details for email
                       const paymentDetails = {
                           method: 'UPI',
                           transactionId: transaction.transactionId,
                           upiTransactionId: transaction.upiTransactionId,
                           date: new Date()
                       };
                       
                       // Generate invoice PDF
                       const invoiceBuffer = await generateInvoicePdf(populatedOrder, paymentDetails);
                       paymentDetails.invoiceBuffer = invoiceBuffer;

                       // Send appropriate email based on plan type
                       console.log('🔍 DEBUG - Checking plan type for email:');
                       console.log('Product ID:', populatedOrder.productId?._id);
                       console.log('Service Name:', populatedOrder.productId?.serviceName);
                       console.log('isMonthlyLimitedPlan:', populatedOrder.productId?.isMonthlyLimitedPlan);

                       if (populatedOrder.productId?.isMonthlyLimitedPlan) {
                           console.log('✅ Sending MONTHLY LIMITED PLAN activation email');
                           // Send special activation email for Monthly Limited Plan
                           await sendMonthlyLimitedPlanActivationEmail(populatedOrder, paymentDetails);
                       } else {
                           console.log('📧 Sending STANDARD purchase confirmation email');
                           // Send standard purchase confirmation email
                           await sendPurchaseConfirmationEmail(populatedOrder, paymentDetails);
                       }

                       // Send admin purchase confirmation email
                       await sendAdminPurchaseConfirmationEmail(populatedOrder, paymentDetails);

                       // Create in-app notification
                       await createPurchaseNotification(populatedOrder);
                   } catch (notificationError) {
                       console.error('Error sending notifications:', notificationError);
                   }
               }
           } catch (orderError) {
               console.error('Error updating order:', orderError);
               orderUpdateMessage = "Error updating order status, but payment was processed";
           }
           
           // Skip adding to wallet for order payments
           skipAddingToWallet = true;
       } else if (transaction.type === 'deposit') {
           // This is a wallet recharge - add funds to wallet
           user.walletBalance += Number(transaction.amount);
           await user.save();
           
           // Send wallet recharge confirmation
           try {
               await sendWalletRechargeConfirmationEmail(user, transaction);
               await createWalletRechargeNotification(user, transaction);
           } catch (notificationError) {
               console.error('Error sending wallet recharge notifications:', notificationError);
           }
       }
       
       res.status(200).json({
           message: isInstallmentPayment 
               ? `Payment approved successfully. ${orderUpdateMessage}`
               : "Transaction approved successfully and funds added to wallet",
           data: {
               transactionId: transaction._id,
               status: 'completed',
               userId: user._id,
               updatedBalance: referrer ? referrer.walletBalance : user.walletBalance,
               isInstallmentPayment: isInstallmentPayment
           },
           success: true,
           error: false
       });
   } catch (err) {
       console.error('Error in approveTransactionController:', err);
       res.status(400).json({
           message: err.message || 'Transaction approval failed',
           error: true,
           success: false
       });
   }
};

module.exports = approveTransactionController;