const uploadProductPermission = require("../../helpers/permission");
const orderModel = require("../../models/orderProductModel");
// const emailService = require("../../helpers/emailService");
// const notificationService = require("../../helpers/notificationService");
const { sendWhatsAppMessage } = require("../../helpers/whatsappService");

async function sendMessageController(req, res) {
    try {
        const sessionUserId = req.userId;
        if(!await uploadProductPermission(sessionUserId)){
            throw new Error("Permission denied");
        }
        
        const { projectId, message, messageId, isEdit, checkpointId, checkpointName } = req.body;
       
        const project = await orderModel.findById(projectId)
            .populate('userId', 'name email phone')  // Populate user details
            .populate('productId')             // Populate product details
            .populate('assignedDeveloper', 'name'); // Populate developer name
       
        if (!project) {
            throw new Error("Project not found");
        }
       
        // Handle message edit or add new message
        if (isEdit && messageId !== undefined) {
            // Find and update existing message
            const messageIndex = project.messages.findIndex(
                msg => (msg.id === messageId || msg._id.toString() === messageId)
            );
           
            if (messageIndex !== -1) {
                project.messages[messageIndex].message = message;
                project.messages[messageIndex].editedAt = new Date();
                
                // Update checkpoint information if provided
                if (checkpointId) {
                    project.messages[messageIndex].checkpointId = checkpointId;
                }
                if (checkpointName) {
                    project.messages[messageIndex].checkpointName = checkpointName;
                }
            } else {
                throw new Error("Message not found for editing");
            }
        } else {
            // Add new message with checkpoint information
            const newMessage = {
                sender: 'admin',
                message: message,
                timestamp: new Date()
            };
            
            // Add checkpoint information if provided
            if (checkpointId) {
                newMessage.checkpointId = checkpointId;
            }
            if (checkpointName) {
                newMessage.checkpointName = checkpointName;
            }
            
            project.messages.push(newMessage);

            const clientPhone = project.userId.phone;
        if (clientPhone) {
            const msgText = `Hello ${project.userId.name},\n\nYou have a new update on your project "${project.productId.serviceName}":\n"${message}"\n\nProgress: ${project.projectProgress}%`;
           const sendStatus = await sendWhatsAppMessage(clientPhone, msgText);
            if (sendStatus?.status === 'not_logged_in') {
                return res.status(200).json({
                    success: false,
                    error: false,
                    message: 'WhatsApp session expired. Please scan QR code.',
                    triggerQr: true
                });
            }
        }


           // COMMENTED OUT: Email and notification functionality for new messages
            /*
            // Send email notification for the new message
            const emailData = {
                message: message,
                projectName: project.productId.serviceName,
                projectProgress: project.projectProgress,
                clientName: project.userId.name,
                developerName: project.assignedDeveloper ? project.assignedDeveloper.name : 'Our team'
            };
           
            // Send email notification
            await emailService.sendProjectMessageEmail(project.userId, emailData, project);
           
            // Create in-app notification
            await notificationService.createProjectMessageNotification(project, message);
             */
        }
       
        // Save the updated project
        await project.save();
       
        // Get the io instance from req (added by middleware)
        const io = req.io;
       
        // Emit update to the specific user
        if (io) {
            io.to(`user_${project.userId._id}`).emit('projectUpdate', {
                projectId: project._id,
                data: {
                    messages: project.messages,
                    projectProgress: project.projectProgress,
                    checkpoints: project.checkpoints
                }
            });
        }
       
        res.status(200).json({
            message: isEdit ? "Message updated successfully" : "Message sent successfully",
            error: false,
            success: true,
            data: project
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = sendMessageController;