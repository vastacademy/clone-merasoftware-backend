const mongoose = require('mongoose')

const addToCart = mongoose.Schema({
    productId : {
      ref : 'product',
      type : String,   
    },
    quantity : Number,
    userId : String,
    // Add new fields for coupon data
    couponCode: {
      type: String,
      default: null
  },
  discountAmount: {
      type: Number,
      default: 0
  },
  finalPrice: {
      type: Number,
      default: null
  }
},{
    timestamps: true
})

const addToCartModel = mongoose.model("addToCart",addToCart)

module.exports = addToCartModel