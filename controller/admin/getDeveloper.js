const DeveloperModel = require("../../models/developerModel");
const userModel = require("../../models/userModel");

const getAllDevelopersController = async (req, res) => {
    try {
        // Find all users with 'developer' role in roles array
        const developerUsers = await userModel.find({ 
            roles: { $in: ['developer'] } 
        });
        
        const developerEmails = developerUsers.map(user => user.email);
        
        const allDevelopers = await DeveloperModel.find({ 
            email: { $in: developerEmails } 
        })
            .sort({ createdAt: -1 })
            .select('-notifications') // Excluding notifications array to reduce response size
            .lean();

        res.json({
            message: "All Developers",
            success: true,
            error: false,
            data: allDevelopers
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = getAllDevelopersController;