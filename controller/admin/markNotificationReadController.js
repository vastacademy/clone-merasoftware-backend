const { markNotificationAsRead } = require('../../helpers/notificationService');

/**
 * Mark notification as read
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
const markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.body;
    
    if (!notificationId) {
      return res.status(400).json({
        message: "Notification ID is required",
        error: true,
        success: false
      });
    }
    
    const notification = await markNotificationAsRead(notificationId);
    
    if (!notification) {
      return res.status(404).json({
        message: "Notification not found",
        error: true,
        success: false
      });
    }
    
    return res.status(200).json({
      message: "Notification marked as read",
      error: false,
      success: true,
      data: notification
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    return res.status(400).json({
      message: error.message || "Failed to mark notification as read",
      error: true,
      success: false
    });
  }
};

module.exports = markNotificationRead;