const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema({
    partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    requestedAmount: {
        type: Number,
        required: true
    },
    selectedBankAccount: {
        bankName: String,
        bankAccountNumber: String,
        bankIFSCCode: String,
        accountHolderName: String,
        upiId: String
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    adminResponse: {
        paymentMode: {
            type: String,
            enum: ['UPI', 'IMPS']
        },
        transactionId: String,
        processedAt: Date,
        rejectionReason: String
    },
    requestedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const withdrawalRequestModel = mongoose.model('commissionWithdrawal', withdrawalRequestSchema);
module.exports = withdrawalRequestModel;