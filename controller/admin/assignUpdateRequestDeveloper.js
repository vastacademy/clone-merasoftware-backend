const updateRequestModel = require("../../models/updateRequestModel");
const developerModel = require("../../models/developerModel");
const assignDeveloperPermission = require("../../helpers/permission");
const { sendDeveloperAssignedNotification, sendDeveloperAssignmentEmail } = require("../../helpers/emailService");
const { createNotification, createDeveloperNotification } = require("../../helpers/notificationService");

async function assignUpdateRequestDeveloper(req, res) {
  try {
    const sessionUserId = req.userId;
   
    // Check if user has permission
    if (!assignDeveloperPermission(sessionUserId)) {
      throw new Error("Permission denied");
    }
   
    const { requestId, developerId } = req.body;
   
    if (!requestId || !developerId) {
      throw new Error("Request ID and Developer ID are required");
    }
   
    // Find the update request
    const updateRequest = await updateRequestModel.findById(requestId);
    if (!updateRequest) {
      throw new Error("Update request not found");
    }
   
    // Check if already assigned
    if (updateRequest.assignedDeveloper) {
      throw new Error("This request is already assigned to a developer");
    }
   
    // Find the developer
    const developer = await developerModel.findById(developerId);
    if (!developer) {
      throw new Error("Developer not found");
    }
   
     // Check developer capacity
     const activeUpdates = developer.currentUpdates ? developer.currentUpdates.length : 0;
     const maxUpdates = developer.workload ? developer.workload.maxUpdatesPerDay : 2;
    
     if (activeUpdates >= maxUpdates) {
       throw new Error("Developer has reached maximum updates capacity");
     }
   
    // Assign developer to update request
    updateRequest.assignedDeveloper = developerId;
    updateRequest.status = 'in_progress';
    updateRequest.assignedAt = new Date();
    await updateRequest.save();
   
    // मैन्युअली अपडेट करें - assignUpdateTask मेथड का उपयोग न करें
    if (!developer.currentUpdates) {
      developer.currentUpdates = [];
    }
    
    developer.currentUpdates.push({
      updatePlan: updateRequest.updatePlanId,
      clientId: updateRequest.userId,
      startDate: new Date(),
      nextUpdateDue: new Date(Date.now() + 24 * 60 * 60 * 1000) // Next day
    });
    
    // Add notification for developer
    if (!developer.notifications) {
      developer.notifications = [];
    }
    
    developer.notifications.push({
      message: `New website update request assigned to you`,
      type: 'Update',
      createdAt: new Date()
    });
    
    await developer.save();

    // Populate the update request for email notification
    const populatedRequest = await updateRequestModel.findById(requestId)
      .populate('userId', 'name email')
      .populate('assignedDeveloper', 'name email department');
    
    // Send email notification to user about developer assignment
    console.log("Sending developer assignment email notification...");
    try {
      await sendDeveloperAssignedNotification(populatedRequest);
      console.log("Developer assigned email notification sent to user");
    } catch (emailError) {
      console.error("Error sending developer assigned email:", emailError);
      // Continue execution even if email fails
    }
    
    // Create in-app notification for the user
    console.log("Creating in-app notification for user...");
    try {
      await createNotification({
        userId: updateRequest.userId,
        type: 'developer_assigned',
        title: 'Developer Assigned',
        message: `A developer has been assigned to your website update request.`,
        relatedId: updateRequest._id,
        onModel: 'UpdateRequest',
        isAdmin: false
      });
      console.log("User in-app notification created");
    } catch (notifError) {
      console.error("Error creating user notification:", notifError);
      // Continue execution even if notification creation fails
    }
   
    // Send email notification to developer about assignment
    console.log("Sending email notification to developer...");
    try {
      await sendDeveloperAssignmentEmail(populatedRequest);
      console.log("Developer assignment email sent");
    } catch (emailError) {
      console.error("Error sending developer assignment email:", emailError);
      // Continue execution even if email fails
    }
    
    // Create in-app notification for the developer
    console.log("Creating in-app notification for developer...");
    try {
      await createDeveloperNotification(populatedRequest);
      console.log("Developer in-app notification created");
    } catch (notifError) {
      console.error("Error creating developer notification:", notifError);
      // Continue execution even if notification creation fails
    }

    return res.status(200).json({
      message: "Developer assigned successfully",
      error: false,
      success: true,
      data: {
        developer: {
          _id: developer._id,
          name: developer.name,
          email: developer.email,
          department: developer.department
        }
      }
    });
  } catch (error) {
    console.error('Error assigning developer:', error);
    return res.status(400).json({
      message: error.message || error,
      error: true,
      success: false
    });
  }
}

module.exports = assignUpdateRequestDeveloper;