const WithdrawalRequest = require("../../models/withdrawalRequestModel");

const getWithdrawalHistory = async (req, res) => {
    try {
        const partnerId = req.userId;
        
        const withdrawals = await WithdrawalRequest.find({ partnerId })
            .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: withdrawals,
            message: "Withdrawal history fetched successfully"
        });
    } catch (error) {
        console.error('Error fetching withdrawal history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch withdrawal history'
        });
    }
};

module.exports = getWithdrawalHistory;