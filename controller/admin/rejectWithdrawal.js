const WithdrawalRequest = require("../../models/withdrawalRequestModel");
const userModel = require("../../models/userModel");

const rejectWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { rejectionReason } = req.body;
        
        const request = await WithdrawalRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: 'Withdrawal request not found'
            });
        }
        
        if (request.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: 'Request is not in pending state'
            });
        }
        
        // Update request status
        request.status = 'rejected';
        request.adminResponse = {
            rejectionReason: rejectionReason,
            processedAt: new Date()
        };
        
        await request.save();
        
        // Refund amount to partner wallet
        const partner = await userModel.findById(request.partnerId);
        partner.walletBalance += request.requestedAmount;
        await partner.save();
        
        res.json({
            success: true,
            message: 'Withdrawal request rejected successfully',
            data: request
        });
    } catch (error) {
        console.error('Error rejecting withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject withdrawal request'
        });
    }
};

module.exports = rejectWithdrawal;