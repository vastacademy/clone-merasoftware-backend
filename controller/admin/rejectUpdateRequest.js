const updateRequestModel = require("../../models/updateRequestModel");
const orderModel = require("../../models/orderProductModel");
const assignDeveloperPermission = require("../../helpers/permission");

async function rejectUpdateRequest(req, res) {
    try {
      const sessionUserId = req.userId;
      
      // Check if user has permission
      if (!assignDeveloperPermission(sessionUserId)) {
        throw new Error("Permission denied");
      }
      
      const { requestId, reason } = req.body;
      
      if (!requestId || !reason) {
        throw new Error("Request ID and reason are required");
      }
      
      // Find the update request
      const updateRequest = await updateRequestModel.findById(requestId);
      if (!updateRequest) {
        throw new Error("Update request not found");
      }
      
      // Check if already completed or rejected
      if (updateRequest.status === 'completed' || updateRequest.status === 'rejected') {
        throw new Error(`This request is already ${updateRequest.status}`);
      }
      
      // Update status to rejected
      updateRequest.status = 'rejected';
      
      // Add rejection reason as a message
      updateRequest.developerMessages = updateRequest.developerMessages || [];
      updateRequest.developerMessages.push({
        message: `Request rejected: ${reason}`,
        timestamp: new Date()
      });
      
      await updateRequest.save();
      
      // Refund the update (optional based on your business logic)
      if (updateRequest.updatePlanId) {
        const updatePlan = await orderModel.findById(updateRequest.updatePlanId);
        if (updatePlan && updatePlan.updatesUsed > 0) {
          updatePlan.updatesUsed -= 1;
          await updatePlan.save();
        }
      }
      
      return res.status(200).json({
        message: "Update request rejected",
        error: false, 
        success: true
      });
    } catch (error) {
      console.error('Error rejecting request:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
  }

module.exports = rejectUpdateRequest  