const PartnerCommission = require("../../models/partnerCommissionModel");

const getCommissionHistory = async (req, res) => {
    try {
        const partnerId = req.userId; // Assuming middleware sets this
        
        const commissions = await PartnerCommission.find({ partnerId })
            .populate('customerId', 'name email phone')
            .populate('orderId', 'createdAt')
            .sort({ createdAt: -1 });
        
        res.json({
            success: true,
            data: commissions,
            message: "Commission history fetched successfully"
        });
    } catch (error) {
        console.error('Error fetching commission history:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch commission history'
        });
    }
};

module.exports = getCommissionHistory;