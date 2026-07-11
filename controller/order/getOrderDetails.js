const orderProductModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const transactionModel = require("../../models/transactionModel");

const toPlainObject = (doc) => {
    if (!doc) return null;
    return typeof doc.toObject === "function" ? doc.toObject() : doc;
};

const toSafeDateValue = (value) => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildProjectHistory = async (order) => {
    const orderId = order._id;

    const [updateRequests, invoices, transactions] = await Promise.all([
        updateRequestModel
            .find({ updatePlanId: orderId })
            .populate("userId", "name email")
            .populate({
                path: "updatePlanId",
                populate: {
                    path: "productId",
                    select: "serviceName",
                },
            })
            .populate("assignedDeveloper", "name designation avatar status")
            .sort({ createdAt: -1 })
            .lean(),
        monthlyInvoiceModel
            .find({ orderId })
            .populate("userId", "name email")
            .populate("orderId", "productId totalPrice price status projectProgress")
            .sort({ createdAt: -1 })
            .lean(),
        transactionModel
            .find({ orderId })
            .populate("userId", "name email")
            .populate("productId", "serviceName")
            .populate("verifiedBy", "name email")
            .sort({ createdAt: -1 })
            .lean(),
    ]);

    const messages = Array.isArray(order.messages)
        ? [...order.messages]
            .map((message, index) => ({
                id: `${message?.checkpointId ?? "general"}-${index}`,
                sender: message?.sender || "user",
                message: message?.message || "",
                timestamp: toSafeDateValue(message?.timestamp || order.updatedAt || order.createdAt),
                checkpointId: message?.checkpointId ?? null,
                checkpointName: message?.checkpointName || null,
            }))
            .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
        : [];

    const checkpointTimeline = Array.isArray(order.checkpoints)
        ? order.checkpoints.map((checkpoint) => {
            const linkedMessages = messages.filter((message) => {
                const messageCheckpointId = message.checkpointId != null ? Number(message.checkpointId) : null;
                return (
                    messageCheckpointId === Number(checkpoint.checkpointId) ||
                    (message.checkpointName && checkpoint.name && message.checkpointName === checkpoint.name)
                );
            });

            return {
                ...checkpoint,
                completedAt: toSafeDateValue(checkpoint.completedAt),
                linkedMessages,
            };
        })
        : [];

    const submissionHistory = updateRequests.map((request) => {
        const instructions = Array.isArray(request.instructions) ? request.instructions : [];
        const files = Array.isArray(request.files) ? request.files : [];

        return {
            ...request,
            createdAt: toSafeDateValue(request.createdAt),
            updatedAt: toSafeDateValue(request.updatedAt),
            completedAt: toSafeDateValue(request.completedAt),
            instructionText: instructions.map((instruction) => instruction?.text).filter(Boolean).join("\n"),
            fileCount: files.length,
            files: files.map((file) => ({
                ...file,
                expirationDate: toSafeDateValue(file?.expirationDate),
            })),
        };
    });

    const fileHistory = submissionHistory.flatMap((request) =>
        (request.files || []).map((file) => ({
            ...file,
            requestId: request._id,
            requestStatus: request.status,
            requestCreatedAt: request.createdAt,
            requestInstructionText: request.instructionText,
        }))
    );

    const timeline = [
        ...checkpointTimeline
            .filter((checkpoint) => checkpoint.completedAt)
            .map((checkpoint) => ({
                type: "checkpoint_completed",
                timestamp: checkpoint.completedAt,
                title: checkpoint.name,
                description: `Checkpoint completed at ${checkpoint.percentage || 0}%`,
                checkpointId: checkpoint.checkpointId,
                checkpointName: checkpoint.name,
            })),
        ...messages.map((message) => ({
            type: "checkpoint_message",
            timestamp: message.timestamp,
            title: message.checkpointName || "Project update",
            description: message.message,
            sender: message.sender,
            checkpointId: message.checkpointId,
            checkpointName: message.checkpointName,
        })),
        ...submissionHistory.map((request) => ({
            type: "update_request",
            timestamp: request.createdAt,
            title: "Update request submitted",
            description: request.instructionText || "No instruction text",
            status: request.status,
            requestId: request._id,
            fileCount: request.fileCount,
        })),
        ...fileHistory.map((file) => ({
            type: "update_file",
            timestamp: file.requestCreatedAt || file.expirationDate || null,
            title: file.originalName || file.filename,
            description: `${file.type || "Unknown type"} • ${file.size || 0} bytes`,
            requestId: file.requestId,
        })),
        ...invoices.map((invoice) => ({
            type: "invoice",
            timestamp: toSafeDateValue(invoice.createdAt),
            title: invoice.invoiceNumber,
            description: `${invoice.status} • ₹${invoice.amount}`,
            invoiceId: invoice._id,
        })),
        ...transactions.map((transaction) => ({
            type: "transaction",
            timestamp: toSafeDateValue(transaction.createdAt || transaction.date),
            title: transaction.transactionId,
            description: `${transaction.type} • ₹${transaction.amount} • ${transaction.status}`,
            transactionId: transaction._id,
        })),
    ].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    return {
        checkpoints: checkpointTimeline,
        messages,
        submissions: submissionHistory,
        files: fileHistory,
        timeline,
        summary: {
            checkpointCount: checkpointTimeline.length,
            completedCheckpointCount: checkpointTimeline.filter((checkpoint) => checkpoint.completed).length,
            messageCount: messages.length,
            submissionCount: submissionHistory.length,
            fileCount: fileHistory.length,
            invoiceCount: invoices.length,
            transactionCount: transactions.length,
        },
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

        if (isAdmin) {
            responseData.projectHistory = await buildProjectHistory(order);
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
