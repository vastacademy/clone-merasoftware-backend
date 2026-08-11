const mongoose = require("mongoose");

const followUpSchema = new mongoose.Schema({
  note: {
    type: String,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const proposalSchema = new mongoose.Schema({
  version: {
    type: Number,
    required: true,
  },
  name: {
    type: String,
    default: "",
  },
  driveFileId: {
    type: String,
    default: "",
  },
  downloadLink: {
    type: String,
    default: "",
  },
  type: {
    type: String,
    default: "",
  },
  size: {
    type: Number,
    default: 0,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
  },
}, { _id: false });

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    default: "",
    trim: true,
  },
  email: {
    type: String,
    default: "",
    trim: true,
    lowercase: true,
  },
  source: {
    type: String,
    default: "",
    trim: true,
  },
  notes: {
    type: String,
    default: "",
  },
  status: {
    type: String,
    enum: ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"],
    default: "New",
  },
  // Versioned proposal/quotation files (Phase 6A). Each upload is a new version
  // so the full revision history / timeline is preserved (client changes over time).
  proposals: {
    type: [proposalSchema],
    default: [],
  },
  // Reserved for Phase 2 (follow-up log).
  followUps: {
    type: [followUpSchema],
    default: [],
  },
  // Set only after Phase 4 convert. Null while the record is still a lead.
  convertedToUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
    default: null,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
  },
}, {
  timestamps: true,
});

const leadModel = mongoose.model("lead", leadSchema);

module.exports = leadModel;
