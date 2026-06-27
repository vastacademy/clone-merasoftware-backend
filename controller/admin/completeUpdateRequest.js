const updateRequestModel = require("../../models/updateRequestModel");
const assignDeveloperPermission = require("../../helpers/permission");
const { sendUpdateCompletedNotification } = require("../../helpers/emailService");
const { createNotification } = require("../../helpers/notificationService");
const { sendWhatsAppMessage } = require("../../helpers/whatsappService"); // ADD THIS IMPORT

async function completeUpdateRequest(req, res) {
    try {
      const sessionUserId = req.userId;
     
      // Check if user has permission
      if (!assignDeveloperPermission(sessionUserId)) {
        throw new Error("Permission denied");
      }
     
      const { requestId } = req.body;
     
      if (!requestId) {
        throw new Error("Request ID is required");
      }
     
      // Find the update request
      const updateRequest = await updateRequestModel.findById(requestId);
      if (!updateRequest) {
        throw new Error("Update request not found");
      }
     
      // Check if already completed
      if (updateRequest.status === 'completed') {
        throw new Error("This request is already completed");
      }
     
      // Update status to completed
      updateRequest.status = 'completed';
      updateRequest.completedAt = new Date();
      await updateRequest.save();
      
      // Populate the update request for notifications
      const populatedRequest = await updateRequestModel.findById(requestId)
        .populate('userId', 'name email phone'); // ADD 'phone' here to get phone number
 
      // COMMENTED OUT: Email notification
      // Send email notification to user about completion
      console.log("Sending completion email notification...");
      try {
        await sendUpdateCompletedNotification(populatedRequest);
        console.log("Completion email notification sent to user");
      } catch (emailError) {
        console.error("Error sending completion email:", emailError);
        // Continue execution even if email fails
      }
 
      // Create in-app notification for the user
      console.log("Creating completion in-app notification for user...");
      try {
        await createNotification({
          userId: updateRequest.userId,
          type: 'completion',
          title: 'Update Request Completed',
          message: `Your website update request has been completed. Please review the changes.`,
          relatedId: updateRequest._id,
          onModel: 'UpdateRequest',
          isAdmin: false
        });
        console.log("User completion notification created");
      } catch (notifError) {
        console.error("Error creating completion notification:", notifError);
        // Continue execution even if notification creation fails
      }

      // Send WhatsApp message notification
      console.log("Sending WhatsApp completion notification...");
      try {
        const clientPhone = populatedRequest.userId.phone;
        if (clientPhone) {
          const whatsappMessage = `Hello ${populatedRequest.userId.name},
              Your website update request has been successfully completed.
              You can now visit your website to view the updates.
                Thank you for choosing our service!`;

          const sendStatus = await sendWhatsAppMessage(clientPhone, whatsappMessage);
          
          if (sendStatus?.status === 'not_logged_in') {
            return res.status(200).json({
              success: false,
              error: false,
              message: 'Update request completed but WhatsApp session expired. Please scan QR code.',
              triggerQr: true
            });
          }
          console.log("WhatsApp completion notification sent");
        } else {
          console.log("No phone number found for user");
        }
      } catch (whatsappError) {
        console.error("Error sending WhatsApp notification:", whatsappError);
        // Continue execution even if WhatsApp fails
      }
     
      return res.status(200).json({
        message: "Update request marked as completed",
        error: false,
        success: true
      });
    } catch (error) {
      console.error('Error completing request:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
}

module.exports = completeUpdateRequest;