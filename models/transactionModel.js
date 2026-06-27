const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true
        },
        transactionId: {
            type: String,
            required: true,
            unique: true
        },
        upiTransactionId: { // Add this field
            type: String,
            default: null
          },
        amount: {
            type: Number,
            required: true
        },
        status: {
            type: String,
            enum: ["pending", "completed", "failed", "refunded", "rejected"],
            default: "pending"
        },
        paymentStatus: {
            type: String,
            enum: ["pending-approval", "approved", "rejected"],
            default: null
        },
        type: {
            type: String,
            enum: ["deposit", "payment", "refund", "renewal"],
            required: true
        },
        description: {
            type: String,
            required: true
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "product"
        },
        quantity: {
            type: Number
        },
        paymentMethod: {
            type: String,
            enum: ["wallet", "upi", "combined"],
            default: "upi"
        },
         // Add parentTransactionId for combined payments
        parentTransactionId: {
            type: String,
            default: null
        },
        paymentDetails: {
            type: Object
        },
        verifiedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user"
        },
        date: {
            type: Date,
            default: Date.now
        },
        isInstallmentPayment: {
            type: Boolean,
            default: false
        },
        installmentNumber: {
            type: Number
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "order"
        },
        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user"
        },
        partnerWalletCredited: {
            type: Boolean,
            default: false
        },
        // Renewal-specific fields
        renewalNumber: {
            type: Number,
            default: null
        },
        renewalPeriodStart: {
            type: Date,
            default: null
        },
        renewalPeriodEnd: {
            type: Date,
            default: null
        },
        isPartialInstallmentPayment: {
            type: Boolean,
            default: false
        },
        rejectionReason: {
            type: String,
            default: null
        },
        rejectedAt: {
            type: Date,
            default: null
        },
        rejectedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            default: null
        }
    },
    { timestamps: true }
);


const transactionModel = mongoose.model('transaction', transactionSchema);
module.exports = transactionModel;