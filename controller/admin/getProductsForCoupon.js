const Product = require('../../models/productModel');

// Get products for coupon selection
const getProductsForCoupon = async (req, res) => {
    try {
      const products = await Product.find({}, 'serviceName category _id');
      
      return res.json({
        success: true,
        data: products
      });
    } catch (error) {
      console.error('Error in getProductsForCoupon:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong'
      });
    }
  };

module.exports = getProductsForCoupon