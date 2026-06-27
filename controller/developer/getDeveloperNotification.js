const { getUnreadNotifications } = require('../../helpers/notificationService');
const developerPermission = require('../../helpers/developerPermission');

/**
 * Get notifications for developer user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getDeveloperNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Verify developer permission
    const hasPermission = await developerPermission(userId);
    if (!hasPermission) {
      return res.status(403).json({
        message: "Permission denied",
        error: true,
        success: false
      });
    }
    
    // Get developer notifications (non-admin)
    const notifications = await getUnreadNotifications(userId, false);
    
    return res.status(200).json({
      message: "Developer notifications retrieved successfully",
      error: false,
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching developer notifications:', error);
    return res.status(400).json({
      message: error.message || "Failed to retrieve notifications",
      error: true,
      success: false
    });
  }
};

module.exports = getDeveloperNotifications;