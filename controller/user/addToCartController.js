const addToCartModel = require("../../models/cartProduct")

const addToCartController = async (req, res) => {
    try {
        const { productId, quantity, couponCode, discountAmount, finalPrice } = req?.body
        const currentUser = req.userId
        const isProductAvailable = await addToCartModel.findOne({ productId, userId: currentUser })
        console.log("isProductAvailable   ", isProductAvailable);
       
        if (isProductAvailable) {
            return res.json({
                message: "Already exists in Add to cart",
                success: false,
                error: true
            })
        }

        // Create the base payload
        const payload = {
            productId: productId,
            quantity: quantity || 1,
            userId: currentUser
        }

        // Add coupon data if provided
        if (couponCode) {
            payload.couponCode = couponCode
            payload.discountAmount = discountAmount
            payload.finalPrice = finalPrice
        }

        const newAddToCart = new addToCartModel(payload)
        const saveProduct = await newAddToCart.save()
        return res.json({
            data: saveProduct,
            message: "Product Added in Cart",
            success: true,
            error: false
        })
    } catch (err) {
        res.json({
            message: err?.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = addToCartController