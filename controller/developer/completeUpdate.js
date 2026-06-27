const updateRequestModel = require("../../models/updateRequestModel");
const developerModel = require("../../models/developerModel");
const developerPermission = require("../../helpers/developerPermission");

async function completeUpdate(req, res) {
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
    
      const { requestId, completionMessage } = req.body;
      
      if (!requestId) {
        throw new Error("Request ID is required");
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
      
      // Check if already completed
      if (updateRequest.status === 'completed') {
        throw new Error("This request is already completed");
      }
      
      // Add completion message if provided
      if (completionMessage) {
        updateRequest.developerMessages = updateRequest.developerMessages || [];
        updateRequest.developerMessages.push({
          message: completionMessage,
          timestamp: new Date()
        });
      }
      
      // Update status to completed
      updateRequest.status = 'completed';
      updateRequest.completedAt = new Date();
      await updateRequest.save();
      
      // Update developer's current updates
      const developer = await developerModel.findById(developerId);
      if (developer) {
        const updateIndex = developer.currentUpdates.findIndex(
          update => update.updatePlan.toString() === updateRequest.updatePlanId.toString()
        );
        
        if (updateIndex >= 0) {
          developer.currentUpdates.splice(updateIndex, 1);
          await developer.save();
        }
      }
      
      return res.status(200).json({
        message: "Update request marked as completed",
        error: false,
        success: true
      });
    } catch (error) {
      console.error('Error completing update:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
  }

module.exports = completeUpdate  