const DeveloperModel = require("../../models/developerModel");

const editDeveloperController = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const updatedDeveloper = await DeveloperModel.findByIdAndUpdate(
            id,
            updateData,
            { new: true } // This option returns the updated document
        );

        if (!updatedDeveloper) {
            return res.status(404).json({
                message: "Developer not found",
                error: true,
                success: false
            });
        }

        res.json({
            message: "Developer updated successfully",
            error: false,
            success: true,
            data: updatedDeveloper
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = editDeveloperController;