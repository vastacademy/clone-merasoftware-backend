const WithdrawalRequest = require("../../models/withdrawalRequestModel");
const userModel = require("../../models/userModel");

const requestWithdrawal = async (req, res) => {
    try {
        const partnerId = req.userId; // Assuming req.userId is set by authentication middleware
        const { amount, selectedBankAccountIndex } = req.body;

        // 1. Validate input
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid withdrawal amount. Amount must be positive.'
            });
        }
        if (selectedBankAccountIndex === undefined || selectedBankAccountIndex < 0) {
            return res.status(400).json({
                success: false,
                message: 'Please select a bank account.'
            });
        }

        // 2. Get partner details
        const partner = await userModel.findById(partnerId);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        // 3. Check available balance
        if (partner.walletBalance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance.'
            });
        }

        // 4. Get selected bank account details
        const bankAccounts = partner.userDetails?.bankAccounts;
        if (!bankAccounts || bankAccounts.length === 0 || selectedBankAccountIndex >= bankAccounts.length) {
            return res.status(400).json({
                success: false,
                message: 'Invalid bank account selection or no bank accounts registered.'
            });
        }
        const selectedAccount = bankAccounts[selectedBankAccountIndex];

        // 5. Create withdrawal request
        const withdrawalRequest = new WithdrawalRequest({
            partnerId: partnerId,
            requestedAmount: amount,
            selectedBankAccount: {
                bankName: selectedAccount.bankName,
                bankAccountNumber: selectedAccount.bankAccountNumber,
                bankIFSCCode: selectedAccount.bankIFSCCode,
                accountHolderName: selectedAccount.accountHolderName,
                upiId: selectedAccount.upiId // Include UPI ID if available
            },
            status: 'pending'
        });

        await withdrawalRequest.save();

        // 6. Deduct from wallet balance
        partner.walletBalance -= amount;
        await partner.save();

        res.json({
            success: true,
            message: 'Withdrawal request submitted successfully. Amount deducted from wallet.',
            data: withdrawalRequest
        });

    } catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to submit withdrawal request. Please try again later.'
        });
    }
};

module.exports = requestWithdrawal;