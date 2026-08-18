const orderProductModel = require("../../models/orderProductModel");
const invoiceModel = require("../../models/invoiceModel");
const transactionModel = require("../../models/transactionModel");

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
            .populate('productId', 'serviceName category totalPages validityPeriod updateCount isWebsiteUpdate price sellingPrice isMonthlyLimitedPlan isMonthlyRenewablePlan monthlyUpdateLimit yearlyPlanDuration monthlyRenewalPrice monthlyRenewalCost isServicePlan servicePlan formattedDescriptions')
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

        // The earliest unpaid/overdue invoice for this order (installment #1 for partial
        // payment, or the single invoice for one-time payment) — used by ProjectDetails.js
        // to show a "Payment Pending" lock. Only invoiceModel (project invoices) is checked
        // here, not monthlyInvoiceModel (recurring plans), since this endpoint only serves
        // project orders.
        const earliestUnpaidInvoice = await invoiceModel
            .findOne({ orderId: order._id, status: { $in: ['unpaid', 'overdue'] } })
            .sort({ installmentNumber: 1, invoiceDate: 1 })
            .select('amount status invoiceNumber installmentNumber')
            .lean();

        const serviceInvoices = order.isServicePlan
            ? await invoiceModel.find({ orderId: order._id }).sort({ invoiceDate: -1 }).select('invoiceNumber amount status invoiceDate dueDate').lean()
            : [];

        // A project is the owner of its add-on service relationship. Return its
        // linked service orders with the project detail payload so the customer
        // has one authoritative workspace instead of reconstructing the link
        // from the global Plans list on the client.
        const linkedServices = !order.isServicePlan
            ? await orderProductModel
                .find({
                    linkedProjectOrderId: order._id,
                    isServicePlan: true,
                    ...(isAdmin ? {} : { userId }),
                })
                .sort({ createdAt: -1 })
                .select([
                    'productId projectSnapshot orderItems orderVisibility createdAt',
                    'servicePlanSnapshot servicePlanStartDate servicePlanEndDate',
                    'serviceCurrentCycleStart serviceCurrentCycleEnd',
                    'serviceAccessUsedInCycle serviceAccessUsedTotal servicePlanStatus',
                    'linkedProjectOrderId addedDuringProjectPhase',
                ].join(' '))
                .populate('productId', 'serviceName category servicePlan formattedDescriptions')
                .lean()
            : [];

        // A payment the customer has already SUBMITTED but the admin has not yet verified.
        // Without this, a submitted-but-unapproved payment is invisible to the customer: the
        // invoice legitimately stays 'unpaid' until approval (only markProjectInvoicePaid settles
        // it), so hasUnpaidInvoice alone kept showing "Payment Pending" — telling the customer to
        // pay again for money they had just sent. The pending transaction is the only record that
        // the money was submitted, so it is derived here alongside hasUnpaidInvoice (same request,
        // same pattern) instead of through a separate endpoint.
        //
        // This replaces the never-implemented `checkPendingOrderTransactions` route ProjectDetails.js
        // used to call — it was never registered in routes/index.js, so that fetch always 404'd and
        // its result was silently discarded (see DOCS/53, which confirmed it dead).
        const pendingPaymentTransaction = await transactionModel
            .findOne({
                orderId: order._id,
                status: 'pending',
                type: 'payment',
            })
            .sort({ createdAt: -1 })
            .select('amount installmentNumber paymentMethod upiTransactionId createdAt')
            .lean();

        const responseData = {
            ...orderData,
            status: status,
            orderNumber: `ORD-${order._id.toString().substr(-4)}`,
            hasUnpaidInvoice: Boolean(earliestUnpaidInvoice),
            unpaidInvoice: earliestUnpaidInvoice || null,
            hasPendingPayment: Boolean(pendingPaymentTransaction),
            pendingPayment: pendingPaymentTransaction || null,
            serviceInvoices,
            linkedServices,
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
