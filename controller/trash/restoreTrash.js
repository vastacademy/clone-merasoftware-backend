const userModel = require("../../models/userModel");
const leadModel = require("../../models/leadModel");

// Restore a trashed record back to active. Clears deletedAt/deletedBy so it reappears
// in every list/search again. For a client, login is re-enabled (isActive:true) since
// trashing had blocked it. type = "client" | "lead".
const restoreTrashController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden", error: true, success: false });
    }

    const { type, id } = req.params;

    if (type === "client") {
      const user = await userModel.findById(id).select("deletedAt roles isActive");
      if (!user || !user.deletedAt) {
        return res.status(404).json({ message: "Client not found in Trash", error: true, success: false });
      }
      user.deletedAt = null;
      user.deletedBy = null;
      user.isActive = true; // re-enable login on restore
      await user.save();
      return res.json({ message: "Client restored", success: true, error: false });
    }

    if (type === "lead") {
      const lead = await leadModel.findById(id).select("deletedAt");
      if (!lead || !lead.deletedAt) {
        return res.status(404).json({ message: "Lead not found in Trash", error: true, success: false });
      }
      lead.deletedAt = null;
      lead.deletedBy = null;
      await lead.save();
      return res.json({ message: "Lead restored", success: true, error: false });
    }

    return res.status(400).json({ message: "Invalid type", error: true, success: false });
  } catch (error) {
    console.error("Error restoring from Trash:", error);
    return res.status(400).json({
      message: error.message || "Failed to restore",
      error: true,
      success: false,
    });
  }
};

module.exports = restoreTrashController;
