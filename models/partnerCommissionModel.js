const mongoose = require('mongoose');

// Partner ki har commission ka detailed record
const partnerCommissionSchema = new mongoose.Schema({
    partnerId: { // Partner ka ID
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    customerId: { // Customer ka ID jisne purchase kiya
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    customerName: String, // Customer name for easy display
    orderId: { // Order reference
        type: mongoose.Schema.Types.ObjectId,
        ref: 'order',
        required: true
    },
    transactionId: { // Transaction reference
        type: mongoose.Schema.Types.ObjectId,
        ref: 'transaction'
    },
    orderAmount: Number, // Total order amount
    commissionAmount: Number, // Commission amount
    commissionRate: Number, // 10% ya 5%
    commissionType: {
        type: String,
        enum: ['first_purchase', 'repeat_purchase'],
        required: true
    },
    status: {
        type: String,
        enum: ['credited'],
        default: 'credited'
    },
    serviceName: String, // Product/Service name
    creditedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

const partnerCommissionModel = mongoose.model('partnerCommission', partnerCommissionSchema);
module.exports = partnerCommissionModel;