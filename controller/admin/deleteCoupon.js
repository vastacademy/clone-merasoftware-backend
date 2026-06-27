const Coupon = require('../../models/couponModel');

// Delete coupon
const deleteCoupon = async (req, res) => {
    try {
      const { id } = req.params;
      
      const coupon = await Coupon.findByIdAndDelete(id);
      
      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }
      
      return res.json({
        success: true,
        message: 'Coupon deleted successfully'
      });
    } catch (error) {
      console.error('Error in deleteCoupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong'
      });
    }
  };

  module.exports = deleteCoupon