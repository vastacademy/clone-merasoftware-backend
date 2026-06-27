const Coupon = require('../../models/couponModel');

// Get all coupons
const getAllCoupons = async (req, res) => {
    try {
      const coupons = await Coupon.find()
        .populate('applicableProducts', 'serviceName category')
        .sort({ createdAt: -1 });
      
      return res.json({
        success: true,
        data: coupons
      });
    } catch (error) {
      console.error('Error in getAllCoupons:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong'
      });
    }
  };

  module.exports = getAllCoupons