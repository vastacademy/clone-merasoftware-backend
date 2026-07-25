const orderProductModel = require("../../models/orderProductModel");

const toPlainObject = (doc) => {
    if (!doc) return null;
    return typeof doc.toObject === "function" ? doc.toObject() : doc;
};

const getCustomerTimeline = (orderData) => {
    if (orderData.projectTimelineVersion !== 1 || !orderData.projectTimelineInitialized) {
        return {
            projectRuns: [],
            projectNodes: [],
            projectNodeEvents: []
        };
    }

    const visibleRuns = (orderData.projectRuns || []).filter(
        (run) => run.status === 'active' || run.showToClient === true
    );
    const visibleRunIds = new Set(visibleRuns.map((run) => run.runId));

    return {
        projectRuns: visibleRuns.map((run) => ({
            runId: run.runId,
            status: run.status,
            startedAt: run.startedAt,
            archivedAt: run.archivedAt,
            showToClient: run.showToClient
        })),
        projectNodes: (orderData.projectNodes || [])
            .filter((node) => visibleRunIds.has(node.runId) && node.visibleToClient === true)
            .map((node) => ({
                nodeId: node.nodeId,
                runId: node.runId,
                title: node.title,
                cumulativeProgress: node.cumulativeProgress,
                status: node.status,
                visibleToClient: node.visibleToClient,
                createdAt: node.createdAt,
                deletedAt: node.deletedAt,
                restoredAt: node.restoredAt,
                messageIds: node.messageIds
            })),
        projectNodeEvents: []
    };
};

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
        const orderData = toPlainObject(order);
        const responseData = {
            ...orderData,
            status: status,
            orderNumber: `ORD-${order._id.toString().substr(-4)}`
        };

        if (!isAdmin) {
            Object.assign(responseData, getCustomerTimeline(orderData));
        }

        res.status(200).json({
            success: true,
            data: responseData
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
