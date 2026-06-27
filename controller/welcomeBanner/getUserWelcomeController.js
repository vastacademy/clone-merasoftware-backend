const UserWelcome = require("../../models/userWelcomeModal")

async function getUserWelcomeController(req, res) {
    try {
        const welcome = await UserWelcome.findOne()
       
        if (!welcome) {
            throw new Error("No active user welcome found")
        }

        res.status(200).json({
            message: "User Welcome Fetched Successfully",
            error: false,
            success: true,
            data: welcome
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = getUserWelcomeController