const Transaction = require('../../models/transactionModel');
const mongoose = require('mongoose');

/**
 * Controller to check if an order has any pending transaction
 * This is used to determine if a payment is awaiting approval
 */
const checkPendingOrderTransactions = async (req, res) => {
  try {
    const { orderId } = req.params;
    const userId = req.userId; // Get the current user ID from request
   
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required'
      });
    }
   
    // Try to convert to ObjectId if it's a valid ObjectId string
    let orderIdQuery;
    try {
      if (mongoose.Types.ObjectId.isValid(orderId)) {
        orderIdQuery = new mongoose.Types.ObjectId(orderId);
      } else {
        orderIdQuery = orderId;
      }
    } catch (error) {
      orderIdQuery = orderId; // Use as string if conversion fails
    }
   
    // Find pending transactions for this order - also include userId filter
    // to ensure we only get transactions from the current user
    const pendingTransactions = await Transaction.find({
      orderId: orderIdQuery,
      status: 'pending',
      isInstallmentPayment: true,
      userId: userId // Add this to filter by current user
    }).sort({ date: -1 }); // Sort by date descending to get most recent first
   
    // Return response with information about pending transactions
    return res.status(200).json({
      success: true,
      data: {
        hasPending: pendingTransactions.length > 0,
        count: pendingTransactions.length,
        // Include first pending transaction details if exists
        installmentNumber: pendingTransactions.length > 0
          ? pendingTransactions[0].installmentNumber
          : null,
        transactionId: pendingTransactions.length > 0
          ? pendingTransactions[0]._id
          : null,
        // Add amount to the response - useful for UI
        amount: pendingTransactions.length > 0
          ? pendingTransactions[0].amount
          : null,
        // Include transaction date
        date: pendingTransactions.length > 0
          ? pendingTransactions[0].date
          : null,
        // Include info about whether this is a partial wallet payment
        isPartialPayment: pendingTransactions.length > 0
          ? (pendingTransactions[0].isPartialInstallmentPayment === true)
          : false
      }
    });
  } catch (error) {
    console.error('Error checking pending transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking pending transactions',
      error: error.message
    });
  }
};

module.exports = checkPendingOrderTransactions;