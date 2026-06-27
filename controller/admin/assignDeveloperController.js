const assignDeveloperPermission = require("../../helpers/permission");
const developerModel = require("../../models/developerModel");
const orderModel = require("../../models/orderProductModel");
const { sendDeveloperAssignedNotification, sendDeveloperAssignmentEmail } = require("../../helpers/emailService");
const { createNotification, createProjectDeveloperAssignedNotification, createProjectDeveloperNotification } = require("../../helpers/notificationService");

async function assignDeveloperController(req, res) {
    try {
        const sessionUserId = req.userId;
       
        // Check if user has permission
        if (!assignDeveloperPermission(sessionUserId)) {
            throw new Error("Permission denied");
        }
        
        const { projectId, developerId } = req.body;
        console.log("Request data:", { projectId, developerId });
        
        if (!projectId || !developerId) {
            throw new Error("Project ID and Developer ID are required");
        }
        
        // Find the project with populated user and product data
        const project = await orderModel.findById(projectId)
            .populate('userId', 'name email')
            .populate('productId', 'serviceName');
            
        console.log("Populated project data:", {
            userId: project.userId ? `${project.userId.name} (${project.userId.email})` : "Not populated",
            productId: project.productId ? project.productId.serviceName : "Not populated"
        });
        
        if (!project) {
            throw new Error("Project not found");
        }
        
        // Find the developer
        const developer = await developerModel.findById(developerId);
        console.log("Developer found:", developer.name, "Active projects:", developer.activeProjects);
        
        if (!developer) {
            throw new Error("Developer not found");
        }
        
        // Check if developer can take more projects
        if (developer.activeProjects && developer.activeProjects.length >= developer.workload.maxProjects) {
            throw new Error("Developer has reached maximum project capacity");
        }
        
        // Assign developer to project
        project.assignedDeveloper = developerId;
        project.assignedAt = new Date();
        await project.save();
        
        // Initialize activeProjects if undefined
        if (!developer.activeProjects) {
            console.log("Initializing empty activeProjects array");
            developer.activeProjects = [];
        }
        
        console.log("Before assignProject call");
        // Add project to developer's active projects
        await developer.assignProject(projectId, {
            projectName: project.productId ? project.productId.serviceName : "New Project",
            role: "Developer"
        });
        console.log("After assignProject call");
        
        const populatedProject = {
            ...project.toObject(),
            assignedDeveloper: developer
        };
        
        // Send email notifications
        console.log("Sending email notifications...");
        try {
            // Send email to client
            await sendDeveloperAssignedNotification(populatedProject, 'project');
            console.log("Developer assigned email notification sent to client");
            
            // Send email to developer
            await sendDeveloperAssignmentEmail(populatedProject, 'project');
            console.log("Project assignment email sent to developer");
        } catch (emailError) {
            console.error("Error sending email notifications:", emailError);
            // Continue execution even if email fails
        }
        
        // Create in-app notifications
        console.log("Creating in-app notifications...");
        try {
            // Create notification for client
            await createNotification({
                userId: project.userId,
                type: 'developer_assigned',
                title: 'Developer Assigned',
                message: `A developer has been assigned to your website project.`,
                relatedId: project._id,
                onModel: 'OrderProduct',
                isAdmin: false
            });
            
            // Create notification for developer
            await createNotification({
                userId: developer._id,
                type: 'project_assigned',
                title: 'New Project Assignment',
                message: `You have been assigned a new website project.`,
                relatedId: project._id,
                onModel: 'OrderProduct',
                isAdmin: false
            });
            
            console.log("Notifications created for client and developer");
        } catch (notifError) {
            console.error("Error creating notifications:", notifError);
            // Continue execution even if notification creation fails
        }
        
        res.status(200).json({
            message: "Developer assigned successfully",
            error: false,
            success: true,
            data: project
        });
    } catch (err) {
        console.error("Error in assignDeveloperController:", err);
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = assignDeveloperController;