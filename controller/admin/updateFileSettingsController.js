const AdminSettings = require('../../models/adminSettingsModel');
const assignDeveloperPermission = require("../../helpers/permission");

const updateFileSettings = async (req, res) => {
  try {
    const sessionUserId = req.userId;
    
    // Check if user has admin permission
    if (!assignDeveloperPermission(sessionUserId)) {
      return res.status(403).json({
        message: "Permission denied",
        error: true,
        success: false
      });
    }
    
    const { fileExpirationDays } = req.body;
    
    // Validate input
    if (!fileExpirationDays || fileExpirationDays < 1 || fileExpirationDays > 365) {
      return res.status(400).json({
        message: "File expiration days must be between 1 and 365",
        error: true,
        success: false
      });
    }
    
    // Get current settings or create if not exists
    const settings = await AdminSettings.getSettings();
    
    // Update settings
    settings.fileExpirationDays = fileExpirationDays;
    await settings.save();
    
    return res.status(200).json({
      message: "File settings updated successfully",
      error: false,
      success: true,
      data: {
        fileExpirationDays: settings.fileExpirationDays
      }
    });
  } catch (error) {
    console.error('Error updating file settings:', error);
    return res.status(500).json({
      message: error.message || "Error updating file settings",
      error: true,
      success: false
    });
  }
};

const getFileSettings = async (req, res) => {
  try {
    const sessionUserId = req.userId;
    
    // Check if user has admin permission
    if (!assignDeveloperPermission(sessionUserId)) {
      return res.status(403).json({
        message: "Permission denied",
        error: true,
        success: false
      });
    }
    
    // Get current settings or create if not exists
    const settings = await AdminSettings.getSettings();
    
    return res.status(200).json({
      message: "File settings retrieved successfully",
      error: false,
      success: true,
      data: {
        fileExpirationDays: settings.fileExpirationDays
      }
    });
  } catch (error) {
    console.error('Error getting file settings:', error);
    return res.status(500).json({
      message: error.message || "Error getting file settings",
      error: true,
      success: false
    });
  }
};

module.exports = {
  updateFileSettings,
  getFileSettings
};