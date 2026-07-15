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
        sourceType: {
            type: String,
            enum: ["wallet", "order", "installment", "invoice", "renewal"],
            default: null
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
            enum: ["wallet", "upi", "combined", "cash", "bank_transfer"],
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
        verificationDate: {
            type: Date,
            default: null
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
        invoiceId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "monthlyInvoice",
            default: null
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

transactionSchema.index({ invoiceId: 1 });
transactionSchema.index({ orderId: 1 });
transactionSchema.index({ userId: 1, status: 1 });
transactionSchema.index({ sourceType: 1, status: 1 });

const transactionModel = mongoose.model('transaction', transactionSchema);
module.exports = transactionModel;
