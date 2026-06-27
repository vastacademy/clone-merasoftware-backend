const mongoose = require('mongoose');

const adSchema = new mongoose.Schema({
  images: [{                                  // Array of images
    type: String,
    required: [true, 'Advertisement image is required'],
    trim: true
  }],
  targetPage: {
    type: String,
    required: [true, 'Target page is required'],
    trim: true
  },
  targetSection: {
    type: String,
    required: [true, 'Target section is required'],
    trim: true
  },
  targetPosition: {
    type: String,
    required: [true, 'Target position is required'],
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date
  }
}, {
  timestamps: true
});

// Validation for at least one image
adSchema.pre('save', function(next) {
  if (this.images.length === 0) {
    next(new Error('At least one image is required'));
  }
  if (this.endDate && this.startDate && this.endDate <= this.startDate) {
    next(new Error('End date must be after start date'));
  }
  next();
});

const adModel = mongoose.model('Ad', adSchema);
module.exports = adModel;