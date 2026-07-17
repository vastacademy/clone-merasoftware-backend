const orderModel = require("../../models/orderProductModel")
const { applyOrderSummary } = require("../../helpers/orderSummary")

const orderController = async (request,response) =>{
    try {
        const currentUserId = request.userId

        const orderList = await applyOrderSummary(
            orderModel.find({ userId : currentUserId }).sort({ createdAt : -1 })
        )

        response.json({
            data : orderList,
            message : "Order List",
            success : true
        })
    } catch (error) {
        response.status(500).json({
            message : error?.message || error,
            error : true,
            success : false
        })
    }
}

module.exports = orderController
