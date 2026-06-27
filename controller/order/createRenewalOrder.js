const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");

/**
 * Create a renewal order for yearly renewable plans
 * This follows the same approval flow as new orders
 */
const createRenewalOrder = async (req, res) => {
  try {
    const userId = req.userId;
    const {
      planId,
      paymentMethod = 'wallet',
      upiTransactionId,
      walletAmount = 0,
      upiAmount = 0
    } = req.body;

    // Validate required fields
    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Plan ID is required"
      });
    }

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

    // Get renewal cost from product
    const renewalCost = plan.productId.monthlyRenewalCost;

    if (!renewalCost || renewalCost <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid renewal cost configuration"
      });
    }

    // Get user details
    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Calculate renewal number (how many times renewed)
    const renewalNumber = (plan.monthlyRenewalHistory?.length || 1);

    // Generate transaction IDs
    const generateTransactionId = (suffix = '') => {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      return `RENEWAL${timestamp}${random}${suffix}`;
    };

    // Prepare renewal period dates (for future activation)
    const currentDate = new Date();
    const renewalStartDate = new Date(currentDate);
    const renewalEndDate = new Date(currentDate);
    renewalEndDate.setDate(renewalEndDate.getDate() + 30);

    // Create transaction records based on payment method
    const transactions = [];

    if (paymentMethod === 'wallet') {
      // Pure wallet payment
      if (user.walletBalance < renewalCost) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: ₹${renewalCost}, Available: ₹${user.walletBalance}`
        });
      }

      const walletTxnId = generateTransactionId('-W');
      const walletTransaction = new transactionModel({
        userId: userId,
        transactionId: walletTxnId,
        amount: renewalCost,
        upiTransactionId: `WALLET-${walletTxnId}`,
        type: 'renewal',
        description: `Monthly renewal for ${plan.productId.serviceName} (Renewal #${renewalNumber})`,
        status: 'pending',
        paymentStatus: 'pending-approval',
        paymentMethod: 'wallet',
        date: new Date(),
        isInstallmentPayment: false,
        orderId: plan._id,
        renewalNumber: renewalNumber,
        renewalPeriodStart: renewalStartDate,
        renewalPeriodEnd: renewalEndDate,
        referredBy: user.referredBy
      });

      await walletTransaction.save();
      transactions.push(walletTransaction);

      console.log(`Wallet renewal transaction created: ${walletTxnId} for plan ${planId}`);

    } else if (paymentMethod === 'upi') {
      // Pure UPI payment
      if (!upiTransactionId || !upiTransactionId.trim()) {
        return res.status(400).json({
          success: false,
          message: "UPI Transaction ID is required for UPI payments"
        });
      }

      const upiTxnId = generateTransactionId('-U');
      const upiTransaction = new transactionModel({
        userId: userId,
        transactionId: upiTxnId,
        amount: renewalCost,
        upiTransactionId: upiTransactionId,
        type: 'renewal',
        description: `Monthly renewal for ${plan.productId.serviceName} (Renewal #${renewalNumber})`,
        status: 'pending',
        paymentStatus: 'pending-approval',
        paymentMethod: 'upi',
        date: new Date(),
        isInstallmentPayment: false,
        orderId: plan._id,
        renewalNumber: renewalNumber,
        renewalPeriodStart: renewalStartDate,
        renewalPeriodEnd: renewalEndDate,
        referredBy: user.referredBy
      });

      await upiTransaction.save();
      transactions.push(upiTransaction);

      console.log(`UPI renewal transaction created: ${upiTxnId} for plan ${planId}`);

    } else if (paymentMethod === 'combined') {
      // Combined payment (Wallet + UPI)
      if (walletAmount + upiAmount !== renewalCost) {
        return res.status(400).json({
          success: false,
          message: "Combined payment amounts do not match renewal cost"
        });
      }

      if (user.walletBalance < walletAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient wallet balance. Required: ₹${walletAmount}, Available: ₹${user.walletBalance}`
        });
      }

      if (!upiTransactionId || !upiTransactionId.trim()) {
        return res.status(400).json({
          success: false,
          message: "UPI Transaction ID is required for combined payments"
        });
      }

      const parentTxnId = generateTransactionId('-COMBINED');

      // Wallet portion
      const walletTxnId = generateTransactionId('-W');
      const walletTransaction = new transactionModel({
        userId: userId,
        transactionId: walletTxnId,
        amount: walletAmount,
        upiTransactionId: `WALLET-${walletTxnId}`,
        type: 'renewal',
        description: `Wallet portion for renewal ${plan.productId.serviceName} (Renewal #${renewalNumber})`,
        status: 'pending',
        paymentStatus: 'pending-approval',
        paymentMethod: 'wallet',
        date: new Date(),
        isInstallmentPayment: false,
        orderId: plan._id,
        renewalNumber: renewalNumber,
        isPartialInstallmentPayment: true,
        parentTransactionId: parentTxnId,
        renewalPeriodStart: renewalStartDate,
        renewalPeriodEnd: renewalEndDate,
        referredBy: user.referredBy
      });

      // UPI portion
      const upiTxnId = generateTransactionId('-U');
      const upiTransaction = new transactionModel({
        userId: userId,
        transactionId: upiTxnId,
        amount: upiAmount,
        upiTransactionId: upiTransactionId,
        type: 'renewal',
        description: `UPI portion for renewal ${plan.productId.serviceName} (Renewal #${renewalNumber})`,
        status: 'pending',
        paymentStatus: 'pending-approval',
        paymentMethod: 'upi',
        date: new Date(),
        isInstallmentPayment: false,
        orderId: plan._id,
        renewalNumber: renewalNumber,
        isPartialInstallmentPayment: true,
        parentTransactionId: parentTxnId,
        renewalPeriodStart: renewalStartDate,
        renewalPeriodEnd: renewalEndDate,
        referredBy: user.referredBy
      });

      await walletTransaction.save();
      await upiTransaction.save();
      transactions.push(walletTransaction, upiTransaction);

      console.log(`Combined renewal transactions created: ${walletTxnId} + ${upiTxnId} for plan ${planId}`);
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid payment method"
      });
    }

    // Return success with transaction details
    res.status(201).json({
      success: true,
      message: paymentMethod === 'wallet'
        ? "Renewal request submitted for admin approval. Your plan will be activated once approved."
        : "Payment verification submitted. Your plan will be renewed after admin approval.",
      data: {
        planId: plan._id,
        planName: plan.productId.serviceName,
        renewalCost: renewalCost,
        renewalNumber: renewalNumber,
        paymentMethod: paymentMethod,
        transactions: transactions.map(t => ({
          transactionId: t.transactionId,
          amount: t.amount,
          method: t.paymentMethod,
          status: t.status
        })),
        expectedRenewalPeriod: {
          start: renewalStartDate,
          end: renewalEndDate
        },
        yearlyDaysRemaining: plan.totalYearlyDaysRemaining
      }
    });

  } catch (error) {
    console.error('Error creating renewal order:', error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to create renewal request"
    });
  }
};

module.exports = createRenewalOrder;
