const Order = require('../../models/orderProductModel');
const Transaction = require('../../models/transactionModel');
const uploadProductPermission = require('../../helpers/permission');

const markInstallmentVerificationPending = async (req, res) => {
    const { orderId, installmentNumber, transactionId, upiTransactionId } = req.body;
    const userId = req.userId;
  
    try {
      // Find the order
      const order = await Order.findOne({ 
        _id: orderId, 
        userId: userId,
        isPartialPayment: true 
      });
  
      if (!order) {
        return res.status(404).json({ 
          success: false, 
          message: 'Order not found or not a partial payment order' 
        });
      }
  
      // Find the specific installment
      const installmentIndex = order.installments.findIndex(
        inst => inst.installmentNumber === parseInt(installmentNumber)
      );
  
      if (installmentIndex === -1) {
        return res.status(404).json({ 
          success: false, 
          message: 'Installment not found' 
        });
      }
  
      const installment = order.installments[installmentIndex];
  
      // Check if installment is already paid
      if (installment.paid) {
        return res.status(400).json({ 
          success: false, 
          message: 'This installment has already been paid' 
        });
      }
  
      // Update the installment status to verification pending
      order.installments[installmentIndex].verificationPending = true;
      await order.save();
  
      return res.status(200).json({
        success: true,
        message: `Installment ${installmentNumber} verification request submitted successfully`,
        data: { transactionId }
      });
    } catch (error) {
      console.error('Error in markInstallmentVerificationPending:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error processing verification request', 
        error: error.message 
      });
    }
  };


module.exports = markInstallmentVerificationPending