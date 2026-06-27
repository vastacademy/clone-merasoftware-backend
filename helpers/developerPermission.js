const userModel = require("../models/userModel")

const developerPermission = async (userId) => {
    try {
        // Check if userId exists
        if (!userId) {
            console.error("Permission check failed: No userId provided");
            return false;
        }
        // Find the user
        const user = await userModel.findById(userId);
       
        // Check if user exists
        if (!user) {
            console.error(`Permission check failed: User with ID ${userId} not found`);
            return false;
        }
        // Check if user is a developer
        if (user.role !== 'DEVELOPER') {
            return false;
        }
       
        return true;
    } catch (error) {
        console.error(`Error checking permissions for user ${userId}:`, error);
        return false;
    }
}
module.exports = developerPermission;