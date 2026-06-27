const uploadProductPermission = require("../../helpers/permission")
const orderModel = require("../../models/orderProductModel")

// getProjectsController.js
async function getProjectsController(req, res) {
    try {
        const sessionUserId = req.userId
        if(!await uploadProductPermission(sessionUserId)){
            throw new Error("Permission denied")
        }

        // Specifically find website projects
        const projects = await orderModel.find({ 
            isWebsiteProject: true,
        })
        .populate('userId', 'name email')
        .populate('productId')
        .sort('-createdAt');

        // Add some console logs for debugging
        console.log("Total projects found:", projects.length);
        console.log("Sample project:", projects[0]);

        res.status(200).json({
            message: "Projects fetched successfully",
            error: false,
            success: true,
            data: projects
        });
    } catch (err) {
        console.error("Error in getProjects:", err);
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = getProjectsController