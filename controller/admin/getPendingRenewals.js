const transactionModel = require("../../models/transactionModel");
const orderModel = require("../../models/orderProductModel");

/**
 * Get all pending renewal transactions for admin review
 */
const getPendingRenewals = async (req, res) => {
  try {
    // Find all pending renewal transactions
    const pendingRenewals = await transactionModel.find({
      type: 'renewal',
      status: 'pending',
      paymentStatus: 'pending-approval'
    })
      .populate('userId', 'name email phone walletBalance')
      .populate('orderId', 'productId currentMonthExpiryDate totalYearlyDaysRemaining monthlyRenewalHistory')
      .sort({ date: -1 }); // Most recent first

    // Group combined payments together
    const groupedRenewals = [];
    const processedParentIds = new Set();

    for (const renewal of pendingRenewals) {
      // Skip if already processed as part of a combined payment
      if (renewal.parentTransactionId && processedParentIds.has(renewal.parentTransactionId)) {
        continue;
      }

      if (renewal.isPartialInstallmentPayment && renewal.parentTransactionId) {
        // This is a combined payment - group all related transactions
        const relatedTransactions = pendingRenewals.filter(
          t => t.parentTransactionId === renewal.parentTransactionId
        );

        const walletPart = relatedTransactions.find(t => t.paymentMethod === 'wallet');
        const upiPart = relatedTransactions.find(t => t.paymentMethod === 'upi');

        groupedRenewals.push({
          type: 'combined',
          parentTransactionId: renewal.parentTransactionId,
          renewalNumber: renewal.renewalNumber,
          totalAmount: relatedTransactions.reduce((sum, t) => sum + t.amount, 0),
          walletAmount: walletPart?.amount || 0,
          upiAmount: upiPart?.amount || 0,
          upiTransactionId: upiPart?.upiTransactionId,
          transactions: relatedTransactions.map(t => ({
            transactionId: t.transactionId,
            amount: t.amount,
            paymentMethod: t.paymentMethod,
            upiTransactionId: t.upiTransactionId
          })),
          user: renewal.userId,
          plan: renewal.orderId,
          renewalPeriod: {
            start: renewal.renewalPeriodStart,
            end: renewal.renewalPeriodEnd
          },
          submittedAt: renewal.date,
          _id: renewal._id // For approval reference
        });

        processedParentIds.add(renewal.parentTransactionId);

      } else {
        // Single payment (wallet or UPI)
        groupedRenewals.push({
          type: 'single',
          transactionId: renewal.transactionId,
          renewalNumber: renewal.renewalNumber,
          amount: renewal.amount,
          paymentMethod: renewal.paymentMethod,
          upiTransactionId: renewal.upiTransactionId,
          user: renewal.userId,
          plan: renewal.orderId,
          renewalPeriod: {
            start: renewal.renewalPeriodStart,
            end: renewal.renewalPeriodEnd
          },
          submittedAt: renewal.date,
          _id: renewal._id
        });
      }
    }

    // Populate plan details for each grouped renewal
    for (const renewal of groupedRenewals) {
      if (renewal.plan) {
        const planDetails = await orderModel.findById(renewal.plan._id)
          .populate('productId', 'serviceName monthlyRenewalCost');

        renewal.planDetails = {
          planId: planDetails._id,
          planName: planDetails.productId?.serviceName,
          monthlyRenewalCost: planDetails.productId?.monthlyRenewalCost,
          currentMonthExpiryDate: planDetails.currentMonthExpiryDate,
          totalYearlyDaysRemaining: planDetails.totalYearlyDaysRemaining,
          previousRenewals: planDetails.monthlyRenewalHistory?.length || 0
        };
      }
    }

    res.status(200).json({
      success: true,
      message: `Found ${groupedRenewals.length} pending renewal(s)`,
      count: groupedRenewals.length,
      data: groupedRenewals
    });

  } catch (error) {
    console.error('Error fetching pending renewals:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch pending renewals'
    });
  }
};

/**
 * Reject a renewal transaction
 */
const rejectRenewalOrder = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { rejectionReason } = req.body;

    // Find the renewal transaction
    const transaction = await transactionModel.findOne({
      transactionId: transactionId,
      type: 'renewal',
      status: 'pending'
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Renewal transaction not found or already processed'
      });
    }

    // Check if this is a combined payment
    const isCombinedPayment = transaction.isPartialInstallmentPayment;
    let relatedTransactions = [transaction];

    if (isCombinedPayment) {
      // Find all transactions with the same parent transaction ID
      const parentTxnId = transaction.parentTransactionId;
      relatedTransactions = await transactionModel.find({
        parentTransactionId: parentTxnId,
        type: 'renewal'
      });
    }

    // Update all related transactions to rejected
    for (const txn of relatedTransactions) {
      txn.status = 'rejected';
      txn.paymentStatus = 'rejected';
      txn.rejectionReason = rejectionReason || 'Payment verification failed';
      txn.rejectedAt = new Date();
      txn.rejectedBy = req.userId; // Admin who rejected
      await txn.save();
    }

    console.log(`Renewal rejected: ${relatedTransactions.map(t => t.transactionId).join(', ')}`);

    // TODO: Send notification to user about rejection
    // await sendRenewalRejectionNotification(transaction.userId, rejectionReason);

    res.status(200).json({
      success: true,
      message: 'Renewal transaction rejected',
      data: {
        transactionsRejected: relatedTransactions.map(t => t.transactionId),
        rejectionReason: rejectionReason
      }
    });

  } catch (error) {
    console.error('Error rejecting renewal:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reject renewal'
    });
  }
};

module.exports = {
  getPendingRenewals,
  rejectRenewalOrder
};
