const bannerModel = require("../../models/bannerModel")

const getBannersController = async (req, res) => {
    try {
        // Get all active banners, sorted by position and displayOrder
        const allBanners = await bannerModel.find()
            .sort({ position: 1, displayOrder: 1 });

        // Group banners by position for easier frontend handling
        const groupedBanners = allBanners.reduce((acc, banner) => {
            if (!acc[banner.position]) {
                acc[banner.position] = [];
            }
            acc[banner.position].push(banner);
            return acc;
        }, {});

        // Sort banners within each position by displayOrder
        Object.keys(groupedBanners).forEach(position => {
            groupedBanners[position].sort((a, b) => a.displayOrder - b.displayOrder);
        });

        console.log("Sending banners:", { 
            total: allBanners.length,
            positions: Object.keys(groupedBanners)
        }); // Debug log

        res.json({
            message: "All Banners Retrieved Successfully",
            success: true,
            error: false,
            data: allBanners,
            groupedData: groupedBanners
        });
    } catch (err) {
        console.error("Error in getBannersController:", err);
        res.status(400).json({
            message: err.message || "Error retrieving banners",
            error: true,
            success: false
        });
    }
}

module.exports = getBannersController;