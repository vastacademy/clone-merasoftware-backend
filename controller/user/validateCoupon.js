const Coupon = require('../../models/couponModel');

const validateCoupon = async (req, res) => {
    try {
        const { code, productId, amount } = req.body;
        
        if (!code || !productId || !amount) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Find coupon and validate it
        const coupon = await Coupon.findOne({
            code: code.toUpperCase(),
            isActive: true,
            startDate: { $lte: new Date() },
            endDate: { $gte: new Date() }
        });

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: 'Invalid or expired coupon'
            });
        }

        // Check if coupon is applicable for this product
        if (coupon.applicableProducts.length > 0 && 
            !coupon.applicableProducts.includes(productId)) {
            return res.status(400).json({
                success: false,
                message: 'Coupon not applicable for this product'
            });
        }

        // Check minimum amount
        if (amount < coupon.minAmount) {
            return res.status(400).json({
                success: false,
                message: `Minimum purchase amount for this coupon is ₹${coupon.minAmount}`
            });
        }

        // Check usage limit
        if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
            return res.status(400).json({
                success: false,
                message: 'Coupon usage limit exceeded'
            });
        }

        // Calculate discount
        let discountAmount = 0;
        if (coupon.type === 'percentage') {
            discountAmount = (amount * coupon.discount) / 100;
            
            // Check if there's a maximum discount cap
            if (coupon.maxDiscount !== null && discountAmount > coupon.maxDiscount) {
                discountAmount = coupon.maxDiscount;
            }
        } else {
            // Fixed amount discount
            discountAmount = coupon.discount;
        }

        // Calculate final price
        const finalPrice = amount - discountAmount;

        return res.json({
            success: true,
            data: {
                couponCode: coupon.code,
                discountAmount,
                finalPrice,
                discountType: coupon.type,
                discountValue: coupon.discount
            }
        });
    } catch (error) {
        console.error('Error validating coupon:', error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong'
        });
    }
};

module.exports = validateCoupon ;