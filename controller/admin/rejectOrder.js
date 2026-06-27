const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
// const { sendOrderNotification } = require("../../helpers/notificationService");

const rejectOrder = async (req, res) => {
    try {
      const { orderId } = req.params;
      const { reason } = req.body;
      
      if (!reason || !reason.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Rejection reason is required'
        });
      }
      
      // Find the order
      const order = await orderModel.findById(orderId)
        .populate('userId', 'name email')
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
      
      // Update order visibility and rejection reason
      order.orderVisibility = 'payment-rejected';
      order.rejectionReason = reason;
      
      // If partial payment, mark installment as rejected
      if (order.isPartialPayment && order.installments.length > 0) {
        const firstInstallment = order.installments.find(i => i.installmentNumber === 1);
        if (firstInstallment) {
          firstInstallment.paymentStatus = 'rejected';
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
          transaction.status = 'failed';
          return transaction.save();
        }));
      }
      
      // Send notification to user
    //   await sendOrderNotification(
    //     order.userId._id,
    //     'Order Rejected',
    //     `Your order for ${order.productId.serviceName} was not approved. Reason: ${reason}`
    //   );
      
      res.json({
        success: true,
        message: 'Order rejected successfully'
      });
    } catch (error) {
      console.error('Error rejecting order:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reject order'
      });
    }
  };

 module.exports = rejectOrder; 