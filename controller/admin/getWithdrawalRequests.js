const WithdrawalRequest = require("../../models/withdrawalRequestModel");

const getWithdrawalRequests = async (req, res) => {
    try {
        const { status = 'pending' } = req.query;
        
        const requests = await WithdrawalRequest.find({ status })
            .populate('partnerId', 'name email')
            .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: requests,
            message: "Withdrawal requests fetched successfully"
        });
    } catch (error) {
        console.error('Error fetching withdrawal requests:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch withdrawal requests'
        });
    }
};

module.exports = getWithdrawalRequests;