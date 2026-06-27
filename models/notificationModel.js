const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true
  },
  type: {
    type: String,
    enum: ['update_request', 'developer_assigned', 'message', 'completion', 'purchase', 'project_message', 'project_update'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  relatedId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'onModel'
  },
  onModel: {
    type: String,
    enum: ['UpdateRequest', 'user', 'OrderProduct']
  },
  isRead: {
    type: Boolean,
    default: false
  },
  isAdmin: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Create indexes for faster queries
notificationSchema.index({ userId: 1, isRead: 1 });
notificationSchema.index({ isAdmin: 1, createdAt: -1 });

// Virtual field to get formatted date
notificationSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
});

const notificationModel = mongoose.model('Notification', notificationSchema);
module.exports = notificationModel;