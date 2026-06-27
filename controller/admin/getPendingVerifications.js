const orderProductModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");


const getPendingVerifications = async (req, res) => {
    try {
        // Fetch pending orders
        const pendingOrders = await orderProductModel.find({ 
            orderVisibility: 'pending-approval' 
        })
        .populate('userId', 'name email phoneNumber')
        .populate('productId', 'serviceName price')
        .sort({ createdAt: -1 });

        // Fetch pending transactions  
        const pendingTransactions = await transactionModel.find({ 
            status: 'pending' 
        })
        .populate('userId', 'name email phoneNumber')
        .populate('orderId', 'productId')
        .sort({ date: -1 });

        const combinedData = [];

        // Add orders to combined data
        pendingOrders.forEach(order => {
            combinedData.push({
                _id: order._id,
                type: 'order_approval',
                displayType: 'New Order Approval',
                customerName: order.userId?.name || 'Unknown',
                customerEmail: order.userId?.email || 'N/A',
                productName: order.productId?.serviceName || 'Unknown Service',
                amount: order.price,
                createdAt: order.createdAt,
                originalData: order
            });
        });

        // Add transactions to combined data
        pendingTransactions.forEach(transaction => {
            let displayType = 'Payment Verification';
            let details = '';

            // Determine transaction type
            if (transaction.isInstallmentPayment) {
                displayType = `Installment #${transaction.installmentNumber}`;
                details = `Installment payment for existing order`;
            } else if (transaction.type === 'wallet_recharge') {
                displayType = 'Wallet Recharge';
                details = 'Wallet recharge request';
            } else if (transaction.type === 'payment') {
                displayType = 'Full Payment';
                details = 'Full order payment';
            }

            combinedData.push({
                _id: transaction._id,
                type: 'payment_verification',
                displayType: displayType,
                customerName: transaction.userId?.name || 'Unknown',
                customerEmail: transaction.userId?.email || 'N/A',
                productName: transaction.orderId?.productId?.serviceName || 'N/A',
                amount: transaction.amount,
                createdAt: transaction.date,
                details: details,
                originalData: transaction
            });
        });

        // Sort combined data by date (newest first)
        combinedData.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ 
            success: true, 
            data: combinedData,
            totalCount: combinedData.length 
        });

    } catch (error) {
        console.error('Error fetching pending verifications:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch pending verifications' 
        });
    }
};

module.exports = { getPendingVerifications };