const mongoose = require('mongoose');

const adminSettingsSchema = new mongoose.Schema({
  fileExpirationDays: {
    type: Number,
    default: 30, // Default to 30 days
    min: 1,
    max: 365
  },
  // Other admin settings can be added here
}, {
  timestamps: true
});

// Ensure only one settings document exists
adminSettingsSchema.statics.getSettings = async function() {
  const settings = await this.findOne();
  if (settings) {
    return settings;
  } else {
    // Create default settings if none exist
    return await this.create({});
  }
};

const AdminSettings = mongoose.model('AdminSettings', adminSettingsSchema);

module.exports = AdminSettings;