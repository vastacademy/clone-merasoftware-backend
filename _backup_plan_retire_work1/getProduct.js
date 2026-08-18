const productModel = require("../../models/productModel")

const getProductController = async (req,res)=>{
    try {
        
        // retiredAt: a retired plan is withdrawn for good and must never be sellable
        // again, even if something later flips isHidden back.
        const allProduct = await productModel.find({ isHidden: false, retiredAt: null }).sort({ createdAt : -1 })

        res.json({
            message : "All Product",
            success : true,
            error : false,
            data : allProduct
        })
    } catch (err) {
        res.status(400).json({
            message : err.message || err,
            error : true,
            success : false
        })
    }
}

module.exports = getProductController
