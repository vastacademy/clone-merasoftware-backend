const transactionModel = require("../../models/transactionModel");
const uploadProductPermission = require("../../helpers/permission");

// Get admin transaction history (all processed transactions)
const adminTransactionHistoryController = async (req, res) => {
    try {
        // Check admin permission
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can access this resource");
        }
        
        // Fetch all processed transactions (completed or failed) - excluding pending
        const transactions = await transactionModel.find({
            status: { $in: ['completed', 'failed'] },
        })
        .populate('userId', 'name email')
        .populate('verifiedBy', 'name email')
        .sort({ date: -1 });
        
        res.status(200).json({
            message: "Admin transaction history fetched successfully",
            data: transactions,
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

module.exports = adminTransactionHistoryController;