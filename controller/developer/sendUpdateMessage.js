const updateRequestModel = require("../../models/updateRequestModel");
const developerPermission = require("../../helpers/developerPermission");

async function sendUpdateMessage(req, res) {
    try {
      const developerId = req.userId;

       // Check developer permission
    const hasPermission = await developerPermission(developerId);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action"
      });
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
      
      // Verify this developer is assigned to this request
      if (updateRequest.assignedDeveloper.toString() !== developerId.toString()) {
        throw new Error("You are not assigned to this update request");
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

module.exports = sendUpdateMessage  