const orderModel = require("../../models/orderProductModel")
const userModel = require("../../models/userModel")

const allOrderController = async(request,response)=>{
    const userId = request.userId
    const userRole = request.userRole

    const user = await userModel.findById(userId)

    if(userRole.toLowerCase() !== 'admin' || !user.roles.includes('admin')){
        return response.status(403).json({
            message : "Unauthorized access"
        })
    }

    const AllOrder = await orderModel.find().sort({ createdAt : -1 })

    return response.status(200).json({
        data : AllOrder,
        success : true
    })

}

module.exports = allOrderController