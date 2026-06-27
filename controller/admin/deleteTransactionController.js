const transactionModel = require("../../models/transactionModel");
const uploadProductPermission = require("../../helpers/permission");

const deleteTransactionController = async (req, res) => {
    try {
        // Check admin permission
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can delete transactions");
        }
        
        const { transactionId } = req.params;
        
        // Find and delete the transaction
        const deletedTransaction = await transactionModel.findByIdAndDelete(transactionId);
        
        if (!deletedTransaction) {
            return res.status(404).json({
                message: "Transaction not found",
                error: true,
                success: false
            });
        }
        
        res.status(200).json({
            message: "Transaction deleted successfully",
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

module.exports = deleteTransactionController;