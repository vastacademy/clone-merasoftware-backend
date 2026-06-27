const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const productModel = require("../../models/productModel");

/**
 * ⚠️ DEPRECATED: This controller is being phased out
 *
 * USE INSTEAD:
 * - createRenewalOrder.js (for user-initiated renewals)
 * - approveRenewalOrder.js (for admin approval)
 *
 * This controller previously allowed direct wallet deduction without admin approval.
 * The new system requires admin verification for all renewals to maintain consistency
 * with the order approval flow.
 *
 * This file is kept temporarily for backward compatibility but should not be used
 * for new renewals.
 */
const renewMonthlyPlan = async (req, res) => {
  try {
    // Return deprecation notice
    return res.status(410).json({
      success: false,
      message: "This renewal method is deprecated. Please use the new renewal flow.",
      deprecationNotice: {
        message: "Direct renewal has been replaced with an approval-based system",
        newEndpoint: "/api/order/create-renewal",
        reason: "To maintain consistency and security, all renewals now require admin approval",
        contact: "Please update your application to use the new renewal flow"
      }
    });

    // OLD CODE BELOW - COMMENTED OUT FOR REFERENCE
    /*
    const userId = req.userId;
    const { planId, paymentMethod = 'wallet' } = req.body;

    // Find the yearly renewable plan
    const plan = await orderModel.findOne({
      _id: planId,
      userId: userId
    }).populate('productId');

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found"
      });
    }

    // Verify it's a yearly renewable plan
    if (!plan.productId?.isMonthlyRenewablePlan) {
      return res.status(400).json({
        success: false,
        message: "This is not a renewable plan"
      });
    }

    // Check if yearly duration is still available
    if (plan.totalYearlyDaysRemaining <= 0) {
      return res.status(400).json({
        success: false,
        message: "Yearly plan duration has expired. Please purchase a new yearly plan."
      });
    }

    // Check if plan is currently expired
    const currentDate = new Date();
    if (plan.currentMonthExpiryDate > currentDate) {
      return res.status(400).json({
        success: false,
        message: "Plan is still active. You can renew 3 days before expiry."
      });
    }

    // Get renewal cost from product
    const renewalCost = plan.productId.monthlyRenewalCost;

    if (!renewalCost || renewalCost <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid renewal cost configuration"
      });
    }

    // ❌ SECURITY ISSUE: Direct wallet deduction without admin verification
    // This was the main loophole in the system
    if (paymentMethod === 'wallet') {
      // Get user wallet balance
      const user = await userModel.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found"
        });
      }

      // Check wallet balance
      if (user.walletBalance < renewalCost) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: ₹${renewalCost}, Available: ₹${user.walletBalance}`
        });
      }

      // ❌ DIRECT DEDUCTION - NO ADMIN APPROVAL
      user.walletBalance -= renewalCost;
      await user.save();

      console.log(`Deducted ₹${renewalCost} from user wallet. New balance: ₹${user.walletBalance}`);
    }
    */

    // Calculate new period dates
    const renewalStartDate = new Date(currentDate);
    const renewalEndDate = new Date(currentDate);
    renewalEndDate.setDate(renewalEndDate.getDate() + 30);

    // Calculate days used from yearly plan (minimum 30, or actual days if less remaining)
    const daysToDeduct = Math.min(30, plan.totalYearlyDaysRemaining);
    const newYearlyDaysRemaining = plan.totalYearlyDaysRemaining - daysToDeduct;

    // Update plan
    plan.currentMonthExpiryDate = renewalEndDate;
    plan.totalYearlyDaysRemaining = newYearlyDaysRemaining;
    plan.autoRenewalStatus = 'active';
    plan.isActive = true;
    plan.currentMonthUpdatesUsed = 0; // Reset monthly counter

    // Add renewal to history
    plan.monthlyRenewalHistory.push({
      renewalDate: renewalStartDate,
      renewalCost: renewalCost,
      paymentStatus: 'paid',
      renewalPeriodStart: renewalStartDate,
      renewalPeriodEnd: renewalEndDate,
      updatesUsedInPeriod: 0
    });

    // If yearly days are exhausted, set final expiry
    if (newYearlyDaysRemaining <= 0) {
      plan.autoRenewalStatus = 'expired';
      console.log('Yearly plan duration exhausted. This is the final renewal.');
    }

    await plan.save();

    // Populate plan for response
    const updatedPlan = await orderModel.findById(planId)
      .populate('userId', 'name email')
      .populate('productId', 'serviceName monthlyRenewalCost yearlyPlanDuration');

    res.status(200).json({
      success: true,
      message: "Plan renewed successfully",
      data: {
        plan: updatedPlan,
        renewalCost: renewalCost,
        newExpiryDate: renewalEndDate,
        yearlyDaysRemaining: newYearlyDaysRemaining,
        paymentMethod: paymentMethod,
        walletBalance: paymentMethod === 'wallet' ? (await userModel.findById(userId)).walletBalance : undefined
      }
    });

  } catch (error) {
    console.error('Error renewing monthly plan:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Internal server error"
    });
  }
};

module.exports = renewMonthlyPlan;