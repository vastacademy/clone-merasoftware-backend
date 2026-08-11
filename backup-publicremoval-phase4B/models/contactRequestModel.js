// models/ContactRequest.js
const mongoose = require('mongoose');

const contactRequestSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true,
    trim: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null
  },
  requestType: {
    type: String,
    default: 'account_creation',
    enum: ['account_creation', 'support', 'general']
  },
  status: {
    type: String,
    default: 'new',
    enum: ['new', 'in_progress', 'completed']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const ContactRequestModel = mongoose.model('ContactRequest', contactRequestSchema);
module.exports = ContactRequestModel;