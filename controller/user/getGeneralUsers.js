const userModel = require("../../models/userModel");

async function getGeneralUsers(req, res) {
    try {
        const generalUsers = await userModel.find(
            { role: "partner"}, 
            { name: 1, email: 1 } // Only return name and email fields
        );

        res.json({
            message: "Partners fetched successfully",
            data: generalUsers,
            success: true,
            error: false
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = getGeneralUsers;