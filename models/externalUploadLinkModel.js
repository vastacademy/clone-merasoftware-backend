const mongoose = require("mongoose");

// Access capability only. It never owns uploaded files, limits, or order state:
// those remain on the existing user/order/update-request sources of truth.
const externalUploadLinkSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "order", required: true, index: true },
  tokenDigest: { type: String, required: true, unique: true, select: false },
  mode: { type: String, enum: ["single", "multiple"], required: true },
  status: { type: String, enum: ["pending", "active", "used", "revoked", "replaced"], default: "pending", index: true },
  useCount: { type: Number, default: 0, min: 0 },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
  replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: "ExternalUploadLink", default: null },
  revokedAt: { type: Date, default: null },
  lastUsedAt: { type: Date, default: null },
  reservationId: { type: String, default: null, select: false },
  reservationExpiresAt: { type: Date, default: null, select: false },
  credentialFailureCount: { type: Number, default: 0, min: 0, select: false },
  credentialFailureWindowStartedAt: { type: Date, default: null, select: false },
  credentialBlockedUntil: { type: Date, default: null, select: false },
}, { timestamps: true });

// Regeneration has exactly one current link per client-record pair.
externalUploadLinkSchema.index(
  { customerId: 1, orderId: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

// Stable cursor pagination for the admin history. `_id` is the tie-breaker when
// multiple generations share the same millisecond timestamp.
externalUploadLinkSchema.index({ customerId: 1, createdAt: -1, _id: -1 });

module.exports = mongoose.model("ExternalUploadLink", externalUploadLinkSchema);
