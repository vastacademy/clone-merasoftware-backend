const { getUnreadNotifications } = require('../../helpers/notificationService');
const uploadProductPermission = require('../../helpers/permission');

/**
 * Get notifications for admin user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getAdminNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Verify admin permission
    if (!await uploadProductPermission(userId)) {
      return res.status(403).json({
        message: "Permission denied",
        error: true,
        success: false
      });
    }
    
    // Get admin notifications
    const notifications = await getUnreadNotifications(userId, true);
    
    return res.status(200).json({
      message: "Admin notifications retrieved successfully",
      error: false,
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching admin notifications:', error);
    return res.status(400).json({
      message: error.message || "Failed to retrieve notifications",
      error: true,
      success: false
    });
  }
};

module.exports = getAdminNotifications;