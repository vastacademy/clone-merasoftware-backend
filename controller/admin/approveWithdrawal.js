const WithdrawalRequest = require("../../models/withdrawalRequestModel");

const approveWithdrawal = async (req, res) => {
    try {
        const { requestId } = req.params;
        const { paymentMode, transactionId } = req.body;
        
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
        request.status = 'approved';
        request.adminResponse = {
            paymentMode: paymentMode,
            transactionId: transactionId,
            processedAt: new Date()
        };
        
        await request.save();
        
        res.json({
            success: true,
            message: 'Withdrawal request approved successfully',
            data: request
        });
    } catch (error) {
        console.error('Error approving withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve withdrawal request'
        });
    }
};

module.exports = approveWithdrawal;