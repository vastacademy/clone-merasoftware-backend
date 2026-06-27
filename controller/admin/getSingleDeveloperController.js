const DeveloperModel = require("../../models/developerModel")

const getSingleDeveloperController = async (req, res) => {
    try {
        const developerId = req.params.id;
        
        if (!developerId) {
            return res.status(400).json({
                message: "Developer ID is required",
                error: true,
                success: false
            });
        }
        
        const developer = await DeveloperModel.findById(developerId)
            .select('-notifications') // Excluding notifications array to reduce response size
            .lean();
            
        if (!developer) {
            return res.status(404).json({
                message: "Developer not found",
                error: true,
                success: false
            });
        }
        
        res.json({
            message: "Developer details",
            success: true,
            error: false,
            data: developer
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = getSingleDeveloperController;