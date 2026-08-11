const leadModel = require("../../models/leadModel");

const deleteLeadController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { leadId } = req.params;

    const lead = await leadModel.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
        error: true,
        success: false,
      });
    }

    // Converted leads are the historical/audit trail behind a real client; deleting
    // one would drop that trail. Block it — the client (userModel) is untouched anyway.
    if (lead.convertedToUserId) {
      return res.status(409).json({
        message: "This lead is converted to a client and cannot be deleted",
        error: true,
        success: false,
      });
    }

    await leadModel.findByIdAndDelete(leadId);

    return res.json({
      message: "Lead deleted",
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error deleting lead:", error);
    return res.status(400).json({
      message: error.message || "Failed to delete lead",
      error: true,
      success: false,
    });
  }
};

module.exports = deleteLeadController;
