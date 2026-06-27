const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");

/**
 * Approve a renewal transaction and activate the plan
 * This is called by admin after verifying the payment
 */
const approveRenewalOrder = async (req, res) => {
  try {
    const { transactionId } = req.params;

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

    // Get the plan
    const plan = await orderModel.findById(transaction.orderId)
      .populate('userId', 'name email walletBalance')
      .populate('productId', 'serviceName monthlyRenewalCost monthlyRenewalPrice isMonthlyLimitedPlan monthlyUpdateLimit');

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Check if this is a combined payment (wallet + UPI)
    const isCombinedPayment = transaction.isPartialInstallmentPayment;
    let relatedTransactions = [transaction];

    if (isCombinedPayment) {
      // Find all transactions with the same parent transaction ID
      const parentTxnId = transaction.parentTransactionId;
      relatedTransactions = await transactionModel.find({
        parentTransactionId: parentTxnId,
        type: 'renewal',
        orderId: plan._id
      });

      // Verify all related transactions are pending
      const allPending = relatedTransactions.every(t => t.status === 'pending');
      if (!allPending) {
        return res.status(400).json({
          success: false,
          message: 'Some transactions in this combined payment are already processed'
        });
      }
    }

    // Calculate total renewal cost from transactions
    const totalRenewalCost = relatedTransactions.reduce((sum, t) => sum + t.amount, 0);

    // Verify renewal cost matches product's monthly renewal cost
    const expectedRenewalCost = plan.productId.isMonthlyLimitedPlan
      ? plan.productId.monthlyRenewalPrice
      : plan.productId.monthlyRenewalCost;

    if (totalRenewalCost !== expectedRenewalCost) {
      return res.status(400).json({
        success: false,
        message: `Payment amount mismatch. Expected: ₹${expectedRenewalCost}, Received: ₹${totalRenewalCost}`
      });
    }

    // Get user
    const user = await userModel.findById(plan.userId._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Deduct wallet amounts from user balance
    let totalWalletDeduction = 0;
    for (const txn of relatedTransactions) {
      if (txn.paymentMethod === 'wallet') {
        if (user.walletBalance < txn.amount) {
          return res.status(400).json({
            success: false,
            message: `Insufficient wallet balance. Required: ₹${txn.amount}, Available: ₹${user.walletBalance}`
          });
        }
        totalWalletDeduction += txn.amount;
      }
    }

    // Deduct total wallet amount
    if (totalWalletDeduction > 0) {
      user.walletBalance -= totalWalletDeduction;
      await user.save();
      console.log(`Deducted ₹${totalWalletDeduction} from user wallet. New balance: ₹${user.walletBalance}`);
    }

    // Calculate new period dates
    const currentDate = new Date();
    const renewalStartDate = new Date(currentDate);
    const renewalEndDate = new Date(currentDate);
    renewalEndDate.setDate(renewalEndDate.getDate() + 30);

    // Calculate days used from yearly plan
    const daysToDeduct = Math.min(30, plan.totalYearlyDaysRemaining);
    const newYearlyDaysRemaining = plan.totalYearlyDaysRemaining - daysToDeduct;

    // Update plan
    plan.currentMonthExpiryDate = renewalEndDate;
    plan.totalYearlyDaysRemaining = newYearlyDaysRemaining;
    plan.autoRenewalStatus = newYearlyDaysRemaining > 0 ? 'active' : 'expired';
    plan.isActive = true;
    plan.currentMonthUpdatesUsed = 0; // Reset monthly counter

    // For monthly limited plans, also reset the monthly counters
    if (plan.productId.isMonthlyLimitedPlan) {
      plan.currentMonthUpdatesLimit = plan.productId.monthlyUpdateLimit;
      plan.currentMonthUpdatesRemaining = plan.productId.monthlyUpdateLimit;
      plan.monthlyLimitResetDate = renewalEndDate; // Set next reset date
    }

    // Add renewal to history
    plan.monthlyRenewalHistory.push({
      renewalDate: renewalStartDate,
      renewalCost: totalRenewalCost,
      paymentStatus: 'paid',
      paymentMethod: relatedTransactions.length > 1 ? 'combined' : relatedTransactions[0].paymentMethod,
      renewalPeriodStart: renewalStartDate,
      renewalPeriodEnd: renewalEndDate,
      updatesUsedInPeriod: 0,
      transactionIds: relatedTransactions.map(t => t.transactionId)
    });

    // If yearly days are exhausted, log it
    if (newYearlyDaysRemaining <= 0) {
      console.log(`Yearly plan duration exhausted for plan ${plan._id}. This was the final renewal.`);
    }

    await plan.save();

    // Update all related transactions to completed
    for (const txn of relatedTransactions) {
      txn.status = 'completed';
      txn.paymentStatus = 'approved';
      txn.approvedAt = new Date();
      txn.approvedBy = req.userId; // Admin who approved
      await txn.save();
    }

    console.log(`Renewal approved for plan ${plan._id}. New expiry: ${renewalEndDate}. Yearly days remaining: ${newYearlyDaysRemaining}`);

    // TODO: Send notification to user
    // await sendRenewalSuccessNotification(user, plan, renewalEndDate);

    res.status(200).json({
      success: true,
      message: 'Renewal approved successfully. Plan has been activated.',
      data: {
        planId: plan._id,
        planName: plan.productId.serviceName,
        renewalCost: totalRenewalCost,
        newExpiryDate: renewalEndDate,
        yearlyDaysRemaining: newYearlyDaysRemaining,
        walletBalanceAfterDeduction: user.walletBalance,
        transactionsApproved: relatedTransactions.map(t => t.transactionId)
      }
    });

  } catch (error) {
    console.error('Error approving renewal:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to approve renewal'
    });
  }
};

module.exports = approveRenewalOrder;
