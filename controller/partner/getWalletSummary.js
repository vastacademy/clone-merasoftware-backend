const PartnerCommission = require("../../models/partnerCommissionModel");
const WithdrawalRequest = require("../../models/withdrawalRequestModel");
const userModel = require("../../models/userModel");

const getWalletSummary = async (req, res) => {
    try {
        const partnerId = req.userId;
        
        // Get partner details
        const partner = await userModel.findById(partnerId, 'walletBalance');
        
        // Calculate total earned
        const totalEarned = await PartnerCommission.aggregate([
            { $match: { partnerId: partnerId } },
            { $group: { _id: null, total: { $sum: "$commissionAmount" } } }
        ]);
        
        // Calculate total withdrawn (approved requests)
        const totalWithdrawn = await WithdrawalRequest.aggregate([
            { $match: { partnerId: partnerId, status: 'approved' } },
            { $group: { _id: null, total: { $sum: "$requestedAmount" } } }
        ]);
        
        // Calculate pending requests
        const pendingRequests = await WithdrawalRequest.aggregate([
            { $match: { partnerId: partnerId, status: 'pending' } },
            { $group: { _id: null, total: { $sum: "$requestedAmount" } } }
        ]);
        
        res.json({
            success: true,
            data: {
                totalEarned: totalEarned[0]?.total || 0,
                availableBalance: partner?.walletBalance || 0,
                totalWithdrawn: totalWithdrawn[0]?.total || 0,
                pendingRequests: pendingRequests[0]?.total || 0
            },
            message: "Wallet summary fetched successfully"
        });
    } catch (error) {
        console.error('Error fetching wallet summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch wallet summary'
        });
    }
};

module.exports = getWalletSummary;