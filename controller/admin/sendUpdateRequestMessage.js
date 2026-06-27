const updateRequestModel = require("../../models/updateRequestModel");
const assignDeveloperPermission = require("../../helpers/permission");

async function sendUpdateRequestMessage(req, res) {
    try {
      const sessionUserId = req.userId;
      
      // Check if user has permission
      if (!assignDeveloperPermission(sessionUserId)) {
        throw new Error("Permission denied");
      }
      
      const { requestId, message } = req.body;
      
      if (!requestId || !message) {
        throw new Error("Request ID and message are required");
      }
      
      // Find the update request
      const updateRequest = await updateRequestModel.findById(requestId);
      if (!updateRequest) {
        throw new Error("Update request not found");
      }
      
      // Add message to request
      updateRequest.developerMessages = updateRequest.developerMessages || [];
      updateRequest.developerMessages.push({
        message,
        timestamp: new Date()
      });
      await updateRequest.save();
      
      return res.status(200).json({
        message: "Message sent successfully",
        error: false,
        success: true
      });
    } catch (error) {
      console.error('Error sending message:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
  }

module.exports = sendUpdateRequestMessage