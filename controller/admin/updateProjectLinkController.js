const uploadProductPermission = require("../../helpers/permission");
const orderModel = require("../../models/orderProductModel");

async function updateProjectLinkController(req, res) {
    try {
        const sessionUserId = req.userId;
        if(!await uploadProductPermission(sessionUserId)){
            throw new Error("Permission denied");
        }
        
        const { projectId, projectLink } = req.body;
        
        if(!projectId) {
            throw new Error("Project ID is required");
        }
        
        // Basic URL validation if link is provided
        if(projectLink) {
            try {
                new URL(projectLink);
            } catch(e) {
                throw new Error("Invalid URL format");
            }
        }
        
        const project = await orderModel.findById(projectId);
        
        if(!project) {
            throw new Error("Project not found");
        }
        
        // Update project link
        project.projectLink = projectLink;
        
        // Save the updated project
        await project.save();
        
        // Get the io instance from req (added by middleware)
        const io = req.io;
        
        // Emit update to the specific user if socket.io is available
        if(io && project.userId) {
            io.to(`user_${project.userId}`).emit('projectUpdate', {
                projectId: project._id,
                data: {
                    projectLink: project.projectLink
                }
            });
        }
        
        res.status(200).json({
            message: "Project link updated successfully",
            error: false,
            success: true,
            data: project
        });
    } catch(err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = updateProjectLinkController;