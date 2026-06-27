const productModel = require("../../models/productModel")

const getProductDetails = async(req,res)=>{
    try {
        const { productId } = req.body;
        
        // Fetch main product details
        const product = await productModel.findById(productId);
        
        // If product has additionalFeatures field, populate them with compatible features
        if (product.additionalFeatures && product.additionalFeatures.length > 0) {
            // Fetch all feature upgrades that are compatible with this product's category
            const compatibleFeatures = await productModel.find({
                _id: { $in: product.additionalFeatures },
                category: 'feature_upgrades',
                compatibleWith: { $in: [product.category] }
            });

            // Add the compatible features to the response
            const productWithFeatures = {
                ...product._doc,
                additionalFeaturesData: compatibleFeatures
            };

            return res.json({
                data: productWithFeatures,
                message: "Ok",
                success: true,
                error: false
            });
        }

        res.json({
            data: product,
            message: "Ok",
            success: true,
            error: false
        });

    } catch (err) {
        res.json({
            message: err?.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = getProductDetails;