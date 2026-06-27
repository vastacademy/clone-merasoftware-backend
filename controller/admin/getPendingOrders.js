const orderModel = require("../../models/orderProductModel");


// Get all pending orders
const getPendingOrders = async (req, res) => {
  try {
    const pendingOrders = await orderModel.find({ 
      orderVisibility: 'pending-approval' 
    })
    .populate('userId', 'name email')
    .populate('productId', 'serviceName category')
    .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: pendingOrders
    });
  } catch (error) {
    console.error('Error fetching pending orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending orders'
    });
  }
};

module.exports = getPendingOrders