const { getUnreadNotifications } = require('../../helpers/notificationService');

/**
 * Get notifications for regular user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const getUserNotifications = async (req, res) => {
  try {
    const userId = req.userId;
    
    // Get user notifications (non-admin)
    const notifications = await getUnreadNotifications(userId, false);
    
    return res.status(200).json({
      message: "User notifications retrieved successfully",
      error: false,
      success: true,
      data: notifications
    });
  } catch (error) {
    console.error('Error fetching user notifications:', error);
    return res.status(400).json({
      message: error.message || "Failed to retrieve notifications",
      error: true,
      success: false
    });
  }
};

module.exports = getUserNotifications;