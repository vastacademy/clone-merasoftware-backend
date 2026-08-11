const orderProductModel = require("../../models/orderProductModel");
const productModel = require("../../models/productModel");
const categoryBasePriceModel = require("../../models/categoryBasePriceModel");
const { sendPurchaseConfirmationEmail, sendMonthlyLimitedPlanActivationEmail, generateInvoicePdf, sendAdminPurchaseConfirmationEmail, sendAdminUPIPendingNotification } = require("../../helpers/emailService");
const { createPurchaseNotification } = require("../../helpers/notificationService");
const { initializeProjectTimeline } = require("../../helpers/projectNodeService");
// SSOT: shared invoice builder — same helper used by the admin/customer custom-project
// and approval flows, so every project order carries one unpaid invoice.
const { createProjectInvoice } = require("../../helpers/paymentRecording");

const DEFAULT_STARTING_NODE_TITLE = "Project Started";

const createOrder = async (req, res) => {
  try {
    const { 
      productId, 
      quantity, 
      price, 
      couponApplied, 
      discountAmount,
      originalPrice,
      isPartialPayment,
      installmentNumber,
      installmentAmount,
      totalAmount,
      remainingAmount,
      remainingPayments,
      selectedFeatures, // Add this to receive selected features
      paymentMethod = 'wallet',
      // Add parameter to track UPI payment status
      upiPaymentStatus,
      orderVisibility = 'pending-approval' // Default to pending-approval
    } = req.body;
    
    const userId = req.userId;

    // Fetch product details
    const product = await productModel.findById(productId);
if (!product) {
  console.error(`Product not found with ID: ${productId}`);
  return res.status(404).json({
    success: false,
    message: "Product not found"
  });
}

console.log('Product full data:', JSON.stringify(product));
console.log('Product category from DB:', product.category);

    // Check if it's a website service
    const isWebsiteService = ['standard_websites', 'dynamic_websites', 'cloud_software_development']
      .includes(product.category);
    const isWebsiteUpdate = product.category === 'website_updates';
    const isYearlyRenewablePlan = product.isMonthlyRenewablePlan || false;

    // Create the base order data
    let orderData = {
      userId,
      productId,
      quantity,
      price, // This is the final price after discount on the total
      originalPrice: originalPrice || (price + (discountAmount || 0)), // Original price before discount
      isWebsiteProject: isWebsiteService,
      isActive: isWebsiteUpdate,
      orderVisibility: 'pending-approval',
      // Initialize orderItems array with main product (no individual discounts)
      orderItems: [{
        id: productId,
        name: product.serviceName,
        type: 'main',
        quantity: quantity,
        originalPrice: product.sellingPrice,
        finalPrice: product.sellingPrice // No individual discount
      }]
    };

    // *** ADD THIS LINE TO INCLUDE REFERREDBY FIELD ***
    // orderData.referredBy = req.body.referredBy;

    // Add coupon information if available
    if (couponApplied) {
      orderData.couponApplied = couponApplied;
      orderData.discountAmount = discountAmount || 0;
      orderData.originalPrice = originalPrice;
    }

    // Add partial payment tracking if applicable
    if (isPartialPayment) {
      orderData.isPartialPayment = true;
      orderData.currentInstallment = installmentNumber || 1;
      orderData.totalAmount = totalAmount;
      
      // CRITICAL CHANGE: Only consider payment complete if wallet payment
      const isPaidByWallet = paymentMethod === 'wallet';
      
      // For wallet payments, mark as paid; for QR/UPI, mark as pending
      if (isPaidByWallet) {
        orderData.paidAmount = price; // Mark as paid for wallet payments
        console.log("Wallet payment - marking first installment as paid");
      } else {
        orderData.paidAmount = 0; // Don't mark as paid for QR payments until approved
        console.log("QR/UPI payment - marking first installment as pending");
      }
      
      orderData.remainingAmount = totalAmount - (isPaidByWallet ? price : 0);
      
      // Create installments array
      const installments = [];
      
      // Log received data for debugging
      console.log("Creating partial payment order with data:", {
        installmentAmount,
        price,
        totalAmount,
        paymentMethod,
        isPaidByWallet
      });
      
      // First installment - CRITICAL CHANGE: Set paid status based on payment method
      installments.push({
        installmentNumber: 1,
        percentage: 30,
        amount: installmentAmount || price,
        // CRITICAL CHANGE: Only mark as paid if wallet payment
        paid: isPaidByWallet,
        // For QR/UPI payments, set payment status to pending-approval
        paymentStatus: isPaidByWallet ? 'none' : (upiPaymentStatus || 'pending-approval'),
        // Only set paid date if actually paid
        paidDate: isPaidByWallet ? new Date() : null
      });
      
      // Add remaining installments if provided
      if (remainingPayments && remainingPayments.length > 0) {
        remainingPayments.forEach(payment => {
          // Validate payment object to prevent errors
          if (!payment.amount) {
            console.error('Invalid payment object missing amount:', payment);
            return;
          }
          
          installments.push({
            installmentNumber: payment.installmentNumber,
            percentage: payment.percentage,
            amount: payment.amount,
            paid: false,
            paymentStatus: 'none',
            // Set due date (30 days from now for installment 2, 60 days for installment 3)
            dueDate: new Date(Date.now() + ((payment.installmentNumber - 1) * 30 * 24 * 60 * 60 * 1000))
          });
        });
      } else {
        // Create default remaining installments if none provided
        const secondInstallmentAmount = Math.round(totalAmount * 0.3);
        const thirdInstallmentAmount = totalAmount - price - secondInstallmentAmount;
        
        // Second installment (30%)
        installments.push({
          installmentNumber: 2,
          percentage: 30,
          amount: secondInstallmentAmount,
          paid: false,
          paymentStatus: 'none',
          dueDate: new Date(Date.now() + (30 * 24 * 60 * 60 * 1000))
        });
        
        // Third installment (40%)
        installments.push({
          installmentNumber: 3,
          percentage: 40,
          amount: thirdInstallmentAmount,
          paid: false,
          paymentStatus: 'none',
          dueDate: new Date(Date.now() + (60 * 24 * 60 * 60 * 1000))
        });
      }
      
      orderData.installments = installments;
      orderData.paymentComplete = false;
    } else {
      // For full payment
      orderData.paymentComplete = paymentMethod === 'wallet';
    }

    if (isWebsiteService) {
      orderData.projectProgress = 0;
      orderData.messages = [];
    }

    if (isWebsiteUpdate) {
      orderData.updatesUsed = 0;
      orderData.isActive = true;

      // Special handling for yearly renewable plans
      if (isYearlyRenewablePlan) {
        const currentDate = new Date();
        const monthExpiryDate = new Date(currentDate);
        monthExpiryDate.setDate(monthExpiryDate.getDate() + 30); // First month starts immediately

        orderData.totalYearlyDaysRemaining = product.yearlyPlanDuration || 365;
        orderData.currentMonthExpiryDate = monthExpiryDate;
        orderData.autoRenewalStatus = 'active';
        orderData.currentMonthUpdatesUsed = 0;

        // Initialize first renewal period in history
        orderData.monthlyRenewalHistory = [{
          renewalDate: currentDate,
          renewalCost: price, // Initial purchase amount
          paymentStatus: 'paid',
          renewalPeriodStart: currentDate,
          renewalPeriodEnd: monthExpiryDate,
          updatesUsedInPeriod: 0
        }];

        console.log('Yearly renewable plan initialized with:', {
          totalYearlyDaysRemaining: orderData.totalYearlyDaysRemaining,
          currentMonthExpiryDate: orderData.currentMonthExpiryDate,
          firstRenewalPeriod: orderData.monthlyRenewalHistory[0]
        });
      }

      // Special handling for monthly limited plans (new feature)
      if (product.isMonthlyLimitedPlan) {
        const currentDate = new Date();
        const monthExpiryDate = new Date(currentDate);
        monthExpiryDate.setDate(monthExpiryDate.getDate() + 30); // First month starts immediately

        orderData.totalYearlyDaysRemaining = product.yearlyPlanDuration || 365;
        orderData.currentMonthExpiryDate = monthExpiryDate;
        orderData.autoRenewalStatus = 'active';
        orderData.currentMonthUpdatesUsed = 0;

        // Set monthly update limits
        orderData.currentMonthUpdatesLimit = product.monthlyUpdateLimit || 1;
        orderData.currentMonthUpdatesRemaining = product.monthlyUpdateLimit || 1;
        orderData.monthlyLimitResetDate = monthExpiryDate;

        // Initialize first renewal period in history
        orderData.monthlyRenewalHistory = [{
          renewalDate: currentDate,
          renewalCost: price, // Initial purchase amount
          paymentStatus: 'paid',
          renewalPeriodStart: currentDate,
          renewalPeriodEnd: monthExpiryDate,
          updatesUsedInPeriod: 0
        }];

        console.log('Monthly limited plan initialized with:', {
          totalYearlyDaysRemaining: orderData.totalYearlyDaysRemaining,
          currentMonthExpiryDate: orderData.currentMonthExpiryDate,
          monthlyUpdateLimit: orderData.currentMonthUpdatesLimit,
          monthlyLimitResetDate: orderData.monthlyLimitResetDate,
          firstRenewalPeriod: orderData.monthlyRenewalHistory[0]
        });
      }
    }

    // Process additional features if provided
    if (selectedFeatures && selectedFeatures.length > 0) {
      // Fetch all feature details in a single query
      const featureIds = selectedFeatures.map(feature => 
        typeof feature === 'object' ? feature.id : feature
      );
      
      const features = await productModel.find({ _id: { $in: featureIds } });
      
      // Map features to orderItems
      const featureItems = features.map(feature => {
        // Find matching selected feature data
        const selectedFeature = selectedFeatures.find(f => 
          (typeof f === 'object' && f.id === feature._id.toString()) || 
          f === feature._id.toString()
        );
        
        // Get quantity (default to 1 if not specified)
        const featureQuantity = (selectedFeature && typeof selectedFeature === 'object' && selectedFeature.quantity) 
          ? selectedFeature.quantity 
          : 1;
        
        // Check if this is an "Add New Page" feature
        const isAddNewPage = feature.serviceName.toLowerCase().includes('add new page');
        
        // Calculate additionalQuantity for "Add New Page" features
        const additionalQuantity = isAddNewPage 
          ? Math.max(0, featureQuantity - product.totalPages) 
          : 0;
        
        // Calculate price based on quantity
        let originalFeaturePrice;
        
        if (isAddNewPage) {
          // For "Add New Page", only charge for additional pages beyond included pages
          originalFeaturePrice = feature.sellingPrice * additionalQuantity;
        } else {
          // For regular features, charge per quantity
          originalFeaturePrice = feature.sellingPrice * featureQuantity;
        }
        
        // Calculate final price (with discount)
        let finalPrice = originalFeaturePrice;
        
        // If coupon discount and total price available, apply proportional discount
        if (couponApplied && discountAmount > 0 && orderData.originalPrice > 0) {
          const proportion = originalFeaturePrice / orderData.originalPrice;
          const featureDiscount = Math.round(discountAmount * proportion);
          finalPrice = Math.max(0, originalFeaturePrice - featureDiscount);
        }
        
        return {
          id: feature._id.toString(),
          name: feature.serviceName,
          type: 'feature',
          quantity: featureQuantity,
          originalPrice: feature.sellingPrice,
          finalPrice: finalPrice,
          additionalQuantity: additionalQuantity
        };
      });
      
      // Add features to orderItems
      orderData.orderItems = [...orderData.orderItems, ...featureItems];
    }

    const order = new orderProductModel(orderData);

    if (isWebsiteService) {
      const categoryBasePrice = await categoryBasePriceModel.findOne({ category: product.category }).lean();
      const startingNodeTitle = categoryBasePrice?.startingNodeTitle?.trim() || DEFAULT_STARTING_NODE_TITLE;
      initializeProjectTimeline({ order, startingNodeTitle, actorId: userId });
    }

    await order.save();

    // SSOT invoice creation — only for website/software PROJECT orders (not plans/updates,
    // which use the separate monthlyInvoiceModel/renewal system). Every project order gets
    // an unpaid invoice so "invoice pending" and "project pending" always exist together;
    // the customer pays via /invoice-detail/:invoiceId (canonical Pay Now) and admin approval
    // marks it paid through the shared markProjectInvoicePaid() helper. Order stays
    // pending-approval until then (Q2).
    if (isWebsiteService) {
      try {
        const invoiceLineItems = (order.orderItems || []).map((item) => ({
          name: item.name,
          price: Number(item.finalPrice ?? item.originalPrice ?? 0),
        }));
        const projectInvoiceDate = new Date();
        if (order.isPartialPayment && Array.isArray(order.installments) && order.installments.length > 0) {
          for (const installment of order.installments) {
            await createProjectInvoice({
              customerId: userId,
              orderId: order._id,
              amount: installment.amount,
              lineItems: invoiceLineItems,
              installmentNumber: installment.installmentNumber,
              invoiceDate: projectInvoiceDate,
              dueDate: installment.dueDate || projectInvoiceDate,
            });
          }
        } else {
          await createProjectInvoice({
            customerId: userId,
            orderId: order._id,
            amount: Number(order.totalAmount || order.price || 0),
            lineItems: invoiceLineItems,
            invoiceDate: projectInvoiceDate,
          });
        }
      } catch (invoiceError) {
        // Invoice creation must never hard-fail checkout — the order is already saved.
        console.error("Project invoice creation failed (order still created):", invoiceError);
      }
    }

    // Fetch the saved order with populated fields
    const populatedOrder = await orderProductModel.findById(order._id)
      .populate('userId', 'name email')
      .populate('productId', 'serviceName category totalPages validityPeriod updateCount isWebsiteUpdate isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice');

    // ===== SEND EMAIL AND CREATE NOTIFICATION FOR WALLET PAYMENTS ONLY =====
    // Only send confirmation for wallet payments, since UPI payments need verification
    if (paymentMethod === 'wallet') {
      try {
        const paymentDetails = {
          method: 'Wallet',
          transactionId: `ORDER-${order._id}`,
          date: new Date()
        };
        
        // Generate invoice PDF
        const invoiceBuffer = await generateInvoicePdf(populatedOrder, paymentDetails);
        paymentDetails.invoiceBuffer = invoiceBuffer;
        
        // Send appropriate email based on plan type
        if (populatedOrder.productId?.isMonthlyLimitedPlan) {
            // Send special activation email for Monthly Limited Plan
            await sendMonthlyLimitedPlanActivationEmail(populatedOrder, paymentDetails);
        } else {
            // Send standard purchase confirmation email
            await sendPurchaseConfirmationEmail(populatedOrder, paymentDetails);
        }

        // Send admin purchase confirmation email
        await sendAdminPurchaseConfirmationEmail(populatedOrder, paymentDetails);

        // Create in-app notification
        await createPurchaseNotification(populatedOrder);

        console.log('Purchase confirmation email and notification sent for order:', order._id);
      } catch (emailError) {
        console.error('Error sending purchase confirmation:', emailError);
        // Continue execution even if notification fails
      }
    } else {
      // UPI payment - notify admin to approve pending order
      try {
        await sendAdminUPIPendingNotification(populatedOrder);
        console.log('Admin pending approval notification sent for UPI order:', order._id);
      } catch (emailError) {
        console.error('Error sending admin pending notification:', emailError);
        // Continue execution even if notification fails
      }
    }

    res.status(201).json({
      message: "Order created successfully",
      success: true,
      data: populatedOrder
    });
  } catch (error) {
    console.error('Error creating order:', error);
    res.status(500).json({
      message: error.message,
      success: false
    });
  }
};

module.exports = createOrder;