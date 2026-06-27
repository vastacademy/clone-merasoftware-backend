const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
const PartnerCommission = require("../../models/partnerCommissionModel");
const userModel = require("../../models/userModel");

// const { sendOrderNotification } = require("../../helpers/notificationService");

const approveOrder = async (req, res) => {
    try {
      const { orderId } = req.params;
      
      // Find the order
      const order = await orderModel.findById(orderId)
        .populate('userId', 'name email referredBy walletBalance')
        .populate('productId', 'serviceName');
      
      if (!order) {
        return res.status(404).json({
          success: false,
          message: 'Order not found'
        });
      }
      
      if (order.orderVisibility !== 'pending-approval') {
        return res.status(400).json({
          success: false,
          message: 'Order is not in pending approval state'
        });
      }
      
      // Update order visibility
      order.orderVisibility = 'approved';
      
      // If partial payment, mark first installment as paid
      if (order.isPartialPayment && order.installments.length > 0) {
        const firstInstallment = order.installments.find(i => i.installmentNumber === 1);
        if (firstInstallment) {
          firstInstallment.paid = true;
          firstInstallment.paidDate = new Date();
          firstInstallment.paymentStatus = 'none';
          
          // Update paid amount
          order.paidAmount = firstInstallment.amount;
          order.remainingAmount = order.totalAmount - order.paidAmount;
        }
      }
      
      // Save the updated order
      await order.save();
      
      // Find and update related transactions
      const transactions = await transactionModel.find({
        orderId: orderId,
        status: 'pending'
      });
      
      if (transactions.length > 0) {
        await Promise.all(transactions.map(async (transaction) => {
          transaction.status = 'completed';
          return transaction.save();
        }));
      }
      
      // Partner wallet credit logic for first full payment purchase or partial payment
      // Check if user has referredBy and this is first order approval
      if (order.userId && order.userId.referredBy) {
        // Check if user has previous approved orders
        const previousApprovedOrders = await orderModel.find({
          userId: order.userId._id,
          orderVisibility: { $in: ['approved', 'visible'] },
          _id: { $ne: order._id }
        });
        
        // Determine commission rate based on order history
        let commissionRate;
        if (previousApprovedOrders.length === 0) {
          commissionRate = 0.10; // 10% for first order
        } else {
          commissionRate = 0.05; // 5% for subsequent orders
        }
        
        const partnerUser = await userModel.findById(order.userId.referredBy);
        if (partnerUser) {
          const referralBonus = order.price * commissionRate;
          partnerUser.walletBalance = (partnerUser.walletBalance || 0) + referralBonus;
          await partnerUser.save();
          
          // NEW: Commission record create karna
          const commissionRecord = new PartnerCommission({
              partnerId: partnerUser._id,
              customerId: order.userId._id,
              customerName: order.userId.name,
              orderId: order._id,
              orderAmount: order.price,
              commissionAmount: referralBonus,
              commissionRate: commissionRate,
              commissionType: previousApprovedOrders.length === 0 ? 'first_purchase' : 'repeat_purchase',
              serviceName: order.productId.serviceName,
              status: 'credited'
          });

         await commissionRecord.save();
          console.log(`Applied ${commissionRate * 100}% commission (${referralBonus}) to partner ${partnerUser._id} for order ${order._id}`);
        }
      }
      
      // Send notification to user
    //   await sendOrderNotification(
    //     order.userId._id,
    //     'Order Approved',
    //     `Your order for ${order.productId.serviceName} has been approved and is now active.`
    //   );
      
      res.json({
        success: true,
        message: 'Order approved successfully'
      });
    } catch (error) {
      console.error('Error approving order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to approve order'
      });
    }
  };

  module.exports = approveOrder;