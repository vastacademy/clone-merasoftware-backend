const mongoose = require('mongoose');

const invoiceLineItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    required: true,
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "order",
    required: true,
  },
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
  },
  invoiceType: {
    type: String,
    enum: ["project", "plan_renewal"],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ["unpaid", "paid", "overdue", "cancelled"],
    default: "unpaid",
  },
  invoiceDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  dueDate: {
    type: Date,
    required: true,
  },
  paidDate: {
    type: Date,
    default: null,
  },
  installmentNumber: {
    type: Number,
    default: null,
  },
  lineItems: {
    type: [invoiceLineItemSchema],
    default: [],
  },
  paymentMethod: {
    type: String,
    enum: ["upi", "bank_transfer", "cash", "wallet", null],
    default: null,
  },
  transactionReference: {
    type: String,
    default: null,
  },
  notes: {
    type: String,
    default: null,
  },
  internalNote: {
    type: String,
    default: null,
  },
  markedPaidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    default: null,
  },
}, {
  timestamps: true,
});

invoiceSchema.index({ userId: 1, status: 1 });
invoiceSchema.index({ orderId: 1 });

const invoiceModel = mongoose.model("invoice", invoiceSchema);
module.exports = invoiceModel;
