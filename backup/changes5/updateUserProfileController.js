const userModel = require("../../models/userModel");

async function updateUserProfileController(req, res) {
    try {
        const userId = req.userId;  
        const { name, phone, age, profilePic } = req.body;

        // Update data object
        const updateData = {
            name,
            phone,
            age
        };

        // अगर profilePic आया है तो उसे भी add करें
        if (profilePic) {
            updateData.profilePic = profilePic;
        }

        const updatedUser = await userModel.findByIdAndUpdate(
            userId,
            updateData,
            { new: true }
        ).select('-password');

        if (!updatedUser) {
            throw new Error("User not found");
        }

        res.status(200).json({
            data: updatedUser,
            error: false,
            success: true,
            message: "Profile updated successfully"
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = updateUserProfileController;