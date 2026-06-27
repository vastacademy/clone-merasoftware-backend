const uploadDeveloperPermission = require("../../helpers/permission")
const developerModel = require("../../models/developerModel")

async function uploadDeveloperController(req, res) {
    try {
        const sessionUserId = req.userId
        
        // Check if user has permission
        if (!uploadDeveloperPermission(sessionUserId)) {
            throw new Error("Permission denied")
        }

        const createDeveloper = new developerModel(req.body)
        const saveDeveloper = await createDeveloper.save()

        res.status(201).json({
            message: "Developer created Successfully",
            error: false,
            success: true,
            data: saveDeveloper
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}

module.exports = uploadDeveloperController