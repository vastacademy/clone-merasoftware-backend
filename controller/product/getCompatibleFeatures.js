const Product = require('../../models/productModel');

const getCompatibleFeaturesController =  async (req, res) => {
    try {
        const { category } = req.query;
        
        // Find features that are compatible with this category
        const features = await Product.find({
            category: 'feature_upgrades',
            compatibleWith: { $in: [category] }
        }).select('serviceName price description upgradeType');
        
        res.json({
            success: true,
            data: features
        });
    } catch (error) {
        console.error('Error fetching compatible features:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching compatible features',
            error: error.message
        });
    }
};

module.exports = getCompatibleFeaturesController