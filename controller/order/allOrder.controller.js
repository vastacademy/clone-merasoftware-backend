const orderModel = require("../../models/orderProductModel")
const userModel = require("../../models/userModel")
const { applyOrderSummary } = require("../../helpers/orderSummary")

const allOrderController = async(request,response)=>{
    const userId = request.userId
    const userRole = request.userRole

    const user = await userModel.findById(userId)

    if(userRole.toLowerCase() !== 'admin' || !user.roles.includes('admin')){
        return response.status(403).json({
            message : "Unauthorized access"
        })
    }

    const requestedLimit = Number(request.query.limit || 50)
    const limit = Math.min(Math.max(requestedLimit, 1), 100)
    const page = Math.max(Number(request.query.page || 1), 1)
    const [AllOrder, total] = await Promise.all([
        applyOrderSummary(orderModel.find().sort({ createdAt : -1 }).skip((page - 1) * limit).limit(limit)),
        orderModel.countDocuments(),
    ])

    return response.status(200).json({
        data : AllOrder,
        success : true,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })

}

module.exports = allOrderController
