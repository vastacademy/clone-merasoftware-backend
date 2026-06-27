const Coupon = require('../../models/couponModel');

// Create new coupon
const createCoupon = async (req, res) => {
  try {
    const {
      code,
      discount,
      type,
      minAmount,
      maxDiscount,
      targetPrice, 
      startDate,
      endDate,
      applicableProducts,
      usageLimit
    } = req.body;
    
    // Basic validation
    if (!code || !discount || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }
    
    // Check if coupon code already exists
    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      return res.status(400).json({
        success: false,
        message: 'Coupon code already exists'
      });
    }
    
    // Create new coupon
    const coupon = await Coupon.create({
      code: code.toUpperCase(),
      discount,
      type: type || 'percentage',
      minAmount: minAmount || 0,
      maxDiscount: maxDiscount || null,
      targetPrice: targetPrice || null,  
      startDate: startDate || new Date(),
      endDate,
      applicableProducts: applicableProducts || [],
      usageLimit: usageLimit || null,
      isActive: true
    });
    
    return res.status(201).json({
      success: true,
      data: coupon,
      message: 'Coupon created successfully'
    });
  } catch (error) {
    console.error('Error in createCoupon:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong'
    });
  }
};

module.exports = createCoupon