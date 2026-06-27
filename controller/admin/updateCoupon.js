const Coupon = require('../../models/couponModel');

// Update coupon
const updateCoupon = async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      
      // If code is being updated, ensure it's in uppercase
      if (updateData.code) {
        updateData.code = updateData.code.toUpperCase();
        
        // Check if new code already exists
        const existingCoupon = await Coupon.findOne({ 
          code: updateData.code,
          _id: { $ne: id }
        });
        
        if (existingCoupon) {
          return res.status(400).json({
            success: false,
            message: 'Coupon code already exists'
          });
        }
      }
      
      const coupon = await Coupon.findByIdAndUpdate(
        id,
        updateData,
        { new: true }
      );
      
      if (!coupon) {
        return res.status(404).json({
          success: false,
          message: 'Coupon not found'
        });
      }
      
      return res.json({
        success: true,
        data: coupon,
        message: 'Coupon updated successfully'
      });
    } catch (error) {
      console.error('Error in updateCoupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong'
      });
    }
  };

  module.exports = updateCoupon