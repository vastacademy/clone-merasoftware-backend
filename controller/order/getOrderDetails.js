const orderProductModel = require("../../models/orderProductModel")

const getOrderDetails = async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.userId;
        const isAdmin = req.userRole === 'admin';
        
        const query = isAdmin ? { _id: orderId } : { _id: orderId, userId };

        // Find the specific order for this user or admin
        const order = await orderProductModel.findOne(query)
            .populate('userId', 'name email address')
            .populate('productId', 'serviceName category totalPages validityPeriod updateCount isWebsiteUpdate price sellingPrice')
            .populate('assignedDeveloper', 'name designation avatar status');
            
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        // Determine the order status for display
        let status = "Processing";
        
        if (order.orderVisibility === 'payment-rejected') {
            status = "Rejected";
        } else if (order.orderVisibility === 'pending-approval') {
            status = "Processing";
        } else if (order.projectProgress >= 100 || order.currentPhase === 'completed') {
            status = "Completed";
        } else if (order.orderVisibility === 'approved' || order.orderVisibility === 'visible') {
            status = "In Progress";
        }
        
        // Send the complete order details
        res.status(200).json({
            success: true,
            data: {
                ...order.toObject(),
                status: status,
                orderNumber: `ORD-${order._id.toString().substr(-4)}`
            }
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = getOrderDetails;
