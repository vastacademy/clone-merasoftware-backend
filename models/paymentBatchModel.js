const mongoose = require("mongoose");

// A payment batch: ONE customer payment that covers SEVERAL orders at once.
//
// Why this is not a transactionModel row
// --------------------------------------
// transactionModel means "one real payment applied to one order" — every row carries a
// single orderId/invoiceId, and transactionService.js infers "no orderId => wallet recharge"
// (see isWalletRecharge there). A batch has N orders, so it can never satisfy that shape:
// forcing it into transactionModel produced an orderId-less row that had to fight the wallet-
// recharge inference with explicit type/sourceType overrides, and still surfaced in the admin
// ledger as a nameless payment sitting in the "Wallet / General Payments" bucket.
//
// So the batch is its own concept: an APPROVAL GROUP, not a payment. The real payments stay in
// transactionModel — one child per order, each with its own orderId/invoiceId, exactly the
// single-ref shape the whole settlement engine already expects. Approving/rejecting a batch
// simply resolves its children through that unchanged path.
//
// batchRef intentionally reuses the same id the children carry in parentTransactionId, so
// every existing child lookup, wallet-refund query, and rollback keeps working untouched.
const paymentBatchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    // Shared id: children's parentTransactionId === this value.
    batchRef: {
      type: String,
      required: true,
      unique: true,
    },
    upiTransactionId: {
      type: String,
      default: null,
    },
    // Total the customer paid for the whole batch (walletPart + upiPart).
    totalAmount: {
      type: Number,
      required: true,
    },
    // Wallet money is the customer's own already-approved balance — debited instantly at
    // purchase, never part of what the admin approves here. Recorded for the ledger only.
    walletPart: {
      type: Number,
      default: 0,
    },
    // The only amount awaiting admin approval.
    upiPart: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["upi", "combined"],
      default: "upi",
    },
    // Context only — the project these services were bought for. Never a settlement target:
    // rejecting a batch must not mark the project itself payment-rejected.
    linkedProjectOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "order",
      default: null,
    },
    // The orders this batch paid for — what the ledger names the batch by.
    orderIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "order",
      },
    ],
    childTransactionIds: [
      {
        type: String,
      },
    ],
    status: {
      type: String,
      enum: ["pending-approval", "approved", "rejected"],
      default: "pending-approval",
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
    verificationDate: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      default: null,
    },
  },
  { timestamps: true }
);

paymentBatchSchema.index({ userId: 1, status: 1 });

const paymentBatchModel = mongoose.model("paymentBatch", paymentBatchSchema);
module.exports = paymentBatchModel;
