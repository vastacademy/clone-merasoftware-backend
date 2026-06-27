const GuestSlides = require("../../models/guestSlidesModal")

async function getGuestSlidesController(req, res) {
    try {
        const slides = await GuestSlides.find()
            .sort({ displayOrder: 1 })
       
        if (!slides) {
            throw new Error("No active guest slides found")
        }

        res.status(200).json({
            message: "Guest Slides Fetched Successfully",
            error: false,
            success: true,
            data: slides
        })
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        })
    }
}


module.exports = getGuestSlidesController