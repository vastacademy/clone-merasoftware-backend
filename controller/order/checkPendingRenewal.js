const transactionModel = require("../../models/transactionModel");

/**
 * Check if a plan has a pending renewal transaction
 */
const checkPendingRenewal = async (req, res) => {
  try {
    const { planId } = req.query;
    const userId = req.userId;

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Plan ID is required"
      });
    }

    // Check if there's a pending renewal transaction for this plan
    const pendingRenewal = await transactionModel.findOne({
      userId: userId,
      orderId: planId,
      type: 'renewal',
      status: 'pending',
      paymentStatus: 'pending-approval'
    }).sort({ date: -1 }); // Get the most recent one

    if (pendingRenewal) {
      return res.status(200).json({
        success: true,
        hasPendingRenewal: true,
        data: {
          transactionId: pendingRenewal.transactionId,
          amount: pendingRenewal.amount,
          paymentMethod: pendingRenewal.paymentMethod,
          submittedAt: pendingRenewal.date,
          renewalNumber: pendingRenewal.renewalNumber
        }
      });
    } else {
      return res.status(200).json({
        success: true,
        hasPendingRenewal: false
      });
    }

  } catch (error) {
    console.error('Error checking pending renewal:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to check pending renewal'
    });
  }
};

module.exports = checkPendingRenewal;
