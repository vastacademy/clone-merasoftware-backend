const uploadProductPermission = require("../../helpers/permission")
const orderModel = require("../../models/orderProductModel")
// const emailService = require("../../helpers/emailService");
// const notificationService = require("../../helpers/notificationService");
// const { sendWhatsAppMessage } = require("../../helpers/whatsappService");

async function updateProgressController(req, res) {
    try {
        const sessionUserId = req.userId
        if(!await uploadProductPermission(sessionUserId)){
            throw new Error("Permission denied")
        }
        const { projectId, checkpointId, name, completed, message } = req.body
       
        const project = await orderModel.findById(projectId)
            .populate('userId', 'name email phone')  // Populate user details
            .populate('productId')             // Populate product details
            .populate('assignedDeveloper', 'name') // Populate developer name
        if (!project) {
            throw new Error("Project not found")
        }
        // Update the specific checkpoint
        const checkpointIndex = project.checkpoints.findIndex(
            cp => cp.checkpointId === checkpointId
        )
        if (checkpointIndex === -1) {
            throw new Error("Checkpoint not found")
        }
        // Update checkpoint completion
        project.checkpoints[checkpointIndex].completed = completed
        project.checkpoints[checkpointIndex].completedAt = completed ? new Date() : null
        
        // Add the message if provided
        if (message && message.trim()) {
            project.messages.push({
                sender: 'admin',
                message: message,
                timestamp: new Date(),
                checkpointId: completed ? checkpointId : null,
                checkpointName: completed ? name : null
            })
        }

        // const clientPhone = project.userId.phone;
        // if (clientPhone) {
        //     const msgText = `Hi ${project.userId.name},\n\nYour project "${project.productId.serviceName}" has progressed to checkpoint "${name}".\nMessage: "${message}"\n\nProgress: ${project.projectProgress}%`;
        //     await sendWhatsAppMessage(clientPhone, msgText);
        // }

        
        // Calculate project progress based on completed checkpoints
        const completedCheckpoints = project.checkpoints.filter(cp => cp.completed).length
        const totalCheckpoints = project.checkpoints.length
        const progressPercentage = Math.round((completedCheckpoints / totalCheckpoints) * 100)
        project.projectProgress = progressPercentage
        
        // Update phase and status based on progress
        if (progressPercentage === 100) {
            project.currentPhase = 'completed'
            project.status = 'completed'
        } else if (progressPercentage >= 75) {
            project.currentPhase = 'review'
            project.status = 'in_progress'
        } else if (progressPercentage >= 25) {
            project.currentPhase = 'development'
            project.status = 'in_progress'
        } else {
            project.currentPhase = 'planning'
            project.status = 'in_progress'
        }
        
        // If all checkpoints are completed, ensure status is completed
        if (completedCheckpoints === totalCheckpoints) {
            project.currentPhase = 'completed'
            project.status = 'completed'
        }
        
        // Save the updated project
        await project.save()
        
        // Get the io instance from req (added by middleware)
        const io = req.io
       
        // Emit update to the specific user with updated fields
        if (io) {
            io.to(`user_${project.userId._id}`).emit('projectUpdate', {
                projectId: project._id,
                data: {
                    messages: project.messages,
                    projectProgress: project.projectProgress,
                    checkpoints: project.checkpoints,
                    currentPhase: project.currentPhase,
                    status: project.status
                }
            })
        }
        
        // COMMENTED OUT: Email and notification functionality
        /*
        // Send email notification to the user about the update
        if (completed && message) {
            // Create email data object with checkpoint update
            const emailData = {
                checkpointName: name,
                message: message,
                projectName: project.productId.serviceName,
                projectProgress: progressPercentage,
                clientName: project.userId.name,
                developerName: project.assignedDeveloper ? project.assignedDeveloper.name : 'Our team'
            };
            
            // Send email notification
            await emailService.sendProjectUpdateEmail(project.userId, emailData, project);
            
            // Create in-app notification
            await notificationService.createProjectUpdateNotification(project, `Checkpoint "${name}" completed: ${message}`);
        }
            */
        
        res.status(200).json({
            message: "Progress updated successfully",
            error: false,
            success: true,
            data: project
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}
module.exports = updateProgressController;