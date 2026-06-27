const orderModel = require("../../models/orderProductModel");

/**
 * Check and update renewal status for all yearly renewable plans
 * This should be called daily via cron job
 */
const checkAndUpdateRenewalStatus = async () => {
  try {
    console.log('Starting daily renewal status check...');

    const currentDate = new Date();

    // Find all yearly renewable plans
    const yearlyPlans = await orderModel.find({
      'productId.isMonthlyRenewablePlan': true,
      totalYearlyDaysRemaining: { $gt: 0 },
      autoRenewalStatus: { $in: ['active', 'paused'] }
    }).populate('productId', 'serviceName monthlyRenewalCost isMonthlyRenewablePlan');

    let expiredCount = 0;
    let processedCount = 0;

    for (const plan of yearlyPlans) {
      try {
        processedCount++;

        // Check if current month has expired
        if (plan.currentMonthExpiryDate && plan.currentMonthExpiryDate <= currentDate) {
          // Deactivate the plan
          plan.isActive = false;
          plan.autoRenewalStatus = 'paused';

          // Update the last renewal period as expired
          if (plan.monthlyRenewalHistory && plan.monthlyRenewalHistory.length > 0) {
            const lastRenewal = plan.monthlyRenewalHistory[plan.monthlyRenewalHistory.length - 1];
            if (lastRenewal.paymentStatus === 'paid') {
              lastRenewal.paymentStatus = 'expired';
              lastRenewal.updatesUsedInPeriod = plan.currentMonthUpdatesUsed || 0;
            }
          }

          await plan.save();
          expiredCount++;

          console.log(`Plan ${plan._id} expired and deactivated`);
        }

        // Check if yearly duration is completely finished
        if (plan.totalYearlyDaysRemaining <= 0) {
          plan.isActive = false;
          plan.autoRenewalStatus = 'expired';
          await plan.save();

          console.log(`Plan ${plan._id} yearly duration completed - permanently expired`);
        }

      } catch (error) {
        console.error(`Error processing plan ${plan._id}:`, error);
      }
    }

    console.log(`Renewal status check completed. Processed: ${processedCount}, Expired: ${expiredCount}`);
    return { processedCount, expiredCount };

  } catch (error) {
    console.error('Error in daily renewal status check:', error);
    throw error;
  }
};

/**
 * Get renewal status for a specific user's plans
 */
const getUserRenewalStatus = async (req, res) => {
  try {
    const userId = req.userId;

    // Find user's yearly renewable plans
    const yearlyPlans = await orderModel.find({
      userId: userId,
      'productId.isMonthlyRenewablePlan': true
    }).populate('productId', 'serviceName monthlyRenewalCost yearlyPlanDuration isMonthlyRenewablePlan')
      .sort({ createdAt: -1 });

    const currentDate = new Date();
    const planStatuses = [];

    for (const plan of yearlyPlans) {
      const daysUntilExpiry = plan.currentMonthExpiryDate
        ? Math.ceil((plan.currentMonthExpiryDate - currentDate) / (1000 * 60 * 60 * 24))
        : 0;

      const planStatus = {
        planId: plan._id,
        serviceName: plan.productId?.serviceName,
        isActive: plan.isActive,
        currentMonthExpiryDate: plan.currentMonthExpiryDate,
        daysUntilExpiry: Math.max(0, daysUntilExpiry),
        totalYearlyDaysRemaining: plan.totalYearlyDaysRemaining,
        autoRenewalStatus: plan.autoRenewalStatus,
        currentMonthUpdatesUsed: plan.currentMonthUpdatesUsed || 0,
        monthlyRenewalCost: plan.productId?.monthlyRenewalCost,
        canRenew: (daysUntilExpiry <= 3) && (plan.totalYearlyDaysRemaining > 0),
        needsRenewal: (daysUntilExpiry <= 0) && (plan.totalYearlyDaysRemaining > 0),
        isYearlyExpired: plan.totalYearlyDaysRemaining <= 0,
        renewalHistory: plan.monthlyRenewalHistory || []
      };

      planStatuses.push(planStatus);
    }

    res.status(200).json({
      success: true,
      message: "Renewal status retrieved successfully",
      data: planStatuses
    });

  } catch (error) {
    console.error('Error getting user renewal status:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

/**
 * Manual trigger for checking renewal status (for testing)
 */
const manualRenewalCheck = async (req, res) => {
  try {
    const result = await checkAndUpdateRenewalStatus();

    res.status(200).json({
      success: true,
      message: "Manual renewal check completed",
      data: result
    });

  } catch (error) {
    console.error('Error in manual renewal check:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

module.exports = {
  checkAndUpdateRenewalStatus,
  getUserRenewalStatus,
  manualRenewalCheck
};