const Order = require('../../models/orderProductModel');
const Product = require('../../models/productModel');
const Category = require('../../models/categoryModel');

const validateUpdatePlan = async (req, res) => {
  try {
    const userId = req.userId;
    const { productId } = req.body;

    // Get the product
    const updateProduct = await Product.findById(productId);
    if (!updateProduct) {
      return res.status(400).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (updateProduct.category !== 'website_updates' || !updateProduct.isWebsiteUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Invalid product category'
      });
    }

    // Get user's orders with full population
    const orders = await Order.find({ userId })
      .populate('productId');

    console.log('Found orders:', orders); // Debug log

    // Check for ongoing projects
    const ongoingProject = orders.find(order => {
      const category = order.productId?.category;
      return (
        category &&
        ['standard_websites', 'dynamic_websites', 'cloud_software_development', 'app_development'].includes(category) &&
        (order.projectProgress < 100 || order.currentPhase !== 'completed')
      );
    });

    if (ongoingProject) {
      return res.status(400).json({
        success: false,
        message: 'Wait until your project is completed before buying an update plan.'
      });
    }

    // Get completed website projects - Now checking both progress and phase
    const completedProjects = orders.filter(order => {
      console.log('Checking order:', {
        category: order.productId?.category,
        progress: order.projectProgress,
        phase: order.currentPhase
      });
      
      return (
        order.productId?.category === 'standard_websites' &&
        order.projectProgress === 100 &&
        order.currentPhase === 'completed'
      );
    });

    console.log('Completed projects:', completedProjects); // Debug log

    if (completedProjects.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'You need to have at least one completed project to buy an update plan.'
      });
    }

    // Get most recent completed project
    const recentProject = completedProjects.sort(
      (a, b) => b.updatedAt - a.updatedAt
    )[0];

    // Verify if recent project was a standard website
    const isStandardWebsite = recentProject.productId?.category === 'standard_websites';
    
    if (!isStandardWebsite) {
      return res.status(400).json({
        success: false,
        message: 'This plan is not compatible with your project.'
      });
    }

    // Check if user already has an active update plan
    const existingUpdatePlan = await Order.findOne({
      userId,
      isActive: true,
      'productId.category': 'website_updates'
    }).populate('productId');

    if (existingUpdatePlan) {
      // If it's a yearly renewable plan, allow only one at a time
      if (existingUpdatePlan.productId?.isMonthlyRenewablePlan) {
        return res.status(400).json({
          success: false,
          message: 'You already have an active yearly renewable plan. Only one yearly plan allowed at a time.'
        });
      }
      // For regular update plans, also restrict to one active plan
      return res.status(400).json({
        success: false,
        message: 'You already have an active update plan. Please deactivate it before purchasing a new one.'
      });
    }

    // All validations passed
    return res.json({
      success: true,
      message: 'Validation successful'
    });

  } catch (error) {
    console.error('Error in validateUpdatePlan:', error);
    return res.status(500).json({
      success: false,
      message: 'Something went wrong'
    });
  }
};

module.exports = validateUpdatePlan;