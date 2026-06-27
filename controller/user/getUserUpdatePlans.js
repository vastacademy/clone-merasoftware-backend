const orderModel = require("../../models/orderProductModel");

  async function getUserUpdatePlans(req, res) {
    try {
      const userId = req.userId;
      const currentDate = new Date();

      // Find all update plans owned by the user
      const userUpdatePlans = await orderModel.find({
        userId,
        'productId.isWebsiteUpdate': true
      }).populate('productId', 'serviceName validityPeriod updateCount isMonthlyRenewablePlan yearlyPlanDuration monthlyRenewalCost isUnlimitedUpdates')
      .sort({ createdAt: -1 });

      // Process plans to add additional status information
      const processedPlans = userUpdatePlans.map(plan => {
        const planData = plan.toObject();

        // For yearly renewable plans, add additional status
        if (plan.productId?.isMonthlyRenewablePlan) {
          const daysUntilExpiry = plan.currentMonthExpiryDate
            ? Math.ceil((plan.currentMonthExpiryDate - currentDate) / (1000 * 60 * 60 * 24))
            : 0;

          planData.renewalStatus = {
            isYearlyRenewable: true,
            daysUntilExpiry: Math.max(0, daysUntilExpiry),
            totalYearlyDaysRemaining: plan.totalYearlyDaysRemaining,
            currentMonthExpiryDate: plan.currentMonthExpiryDate,
            autoRenewalStatus: plan.autoRenewalStatus,
            currentMonthUpdatesUsed: plan.currentMonthUpdatesUsed || 0,
            monthlyRenewalCost: plan.productId.monthlyRenewalCost,
            canRenew: (daysUntilExpiry <= 3) && (plan.totalYearlyDaysRemaining > 0),
            needsRenewal: (daysUntilExpiry <= 0) && (plan.totalYearlyDaysRemaining > 0),
            isYearlyExpired: (plan.totalYearlyDaysRemaining <= 0),
            renewalHistory: plan.monthlyRenewalHistory || []
          };
        } else {
          // For regular update plans, calculate remaining days
          const validityInDays = plan.productId.validityPeriod;
          if (validityInDays) {
            const startDate = new Date(plan.createdAt);
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + validityInDays);
            const remainingDays = Math.ceil((endDate - currentDate) / (1000 * 60 * 60 * 24));

            planData.remainingDays = Math.max(0, remainingDays);
            planData.isExpired = remainingDays <= 0;
          }
        }

        return planData;
      });

      // Filter active plans (including both types)
      const activePlans = processedPlans.filter(plan => {
        if (plan.productId?.isMonthlyRenewablePlan) {
          // For yearly plans, check if not yearly expired and currently active
          return plan.renewalStatus && !plan.renewalStatus.isYearlyExpired && plan.isActive;
        } else {
          // For regular plans, check traditional active status
          return plan.isActive && (!plan.isExpired);
        }
      });

      return res.status(200).json({
        message: "Update plans retrieved successfully",
        error: false,
        success: true,
        data: activePlans
      });
    } catch (error) {
      console.error('Error fetching user update plans:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
  }

module.exports = getUserUpdatePlans