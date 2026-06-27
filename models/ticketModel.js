const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  ticketId: {
    type: String,
    unique: true,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['Billing', 'Technical', 'Product', 'Account', 'Other'] // आप अपने categories ऐड कर सकते हैं
  },
  subject: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'open', 'closed'],
    default: 'pending'
  },
  messages: [{
    sender: {
      type: String,
      enum: ['user', 'admin'],
      required: true
    },
    message: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  statusHistory: [{
    status: {
      type: String,
      enum: ['pending', 'open', 'closed'],
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'user'
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Generate unique ticket ID before saving
ticketSchema.pre('save', async function(next) {
  if (!this.ticketId) {
    // Format: TKT-YEAR-MONTH-Random5Digits
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    this.ticketId = `TKT-${year}${month}-${randomDigits}`;
    
    // Add initial status to history
    if (!this.statusHistory || this.statusHistory.length === 0) {
      this.statusHistory = [{
        status: 'pending',
        timestamp: Date.now(),
        updatedBy: this.userId
      }];
    }
  }
  next();
});

const TicketModel = mongoose.model('Ticket', ticketSchema);

module.exports = TicketModel;