const userModel = require("../../models/userModel");
const transactionModel = require("../../models/transactionModel");
const uploadProductPermission = require("../../helpers/permission");

// Get all pending transactions
const getPendingTransactionsController = async (req, res) => {
    try {
        // Check admin permission
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can access this resource");
        }
       
        // Fetch ALL pending transactions with more information
        const pendingTransactions = await transactionModel.find({
            status: 'pending'
        })
        .populate('userId', 'name email')
        .populate('orderId', 'productId serviceName') // Add this to get product info
        .sort({ date: -1 });
        
        // Map transactions to include friendly type label
        const mappedTransactions = pendingTransactions.map(transaction => {
            const transactionObj = transaction.toObject();
            // Add a friendlyType field for UI display
            transactionObj.friendlyType = transaction.isInstallmentPayment 
                ? `Installment #${transaction.installmentNumber} Payment` 
                : 'Wallet Recharge';
                
            return transactionObj;
        });
       
        res.status(200).json({
            message: "Pending transactions fetched successfully",
            data: mappedTransactions,
            success: true,
            error: false
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = getPendingTransactionsController;