const leadModel = require("../../models/leadModel");

const ALLOWED_STATUSES = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];

const updateLeadController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { leadId } = req.params;
    const { action } = req.body;

    const lead = await leadModel.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
        error: true,
        success: false,
      });
    }

    // Converted leads are historical; block further edits (Phase 4 owns convert).
    if (lead.convertedToUserId) {
      return res.status(409).json({
        message: "This lead is already converted to a client and cannot be edited",
        error: true,
        success: false,
      });
    }

    if (action === "status") {
      const { status } = req.body;
      if (!ALLOWED_STATUSES.includes(status)) {
        return res.status(400).json({
          message: "Invalid status",
          error: true,
          success: false,
        });
      }
      lead.status = status;
    } else if (action === "followUp") {
      const note = (req.body.note || "").trim();
      if (!note) {
        return res.status(400).json({
          message: "Please provide a follow-up note",
          error: true,
          success: false,
        });
      }
      lead.followUps.push({
        note,
        date: new Date(),
        createdBy: req.userId,
        createdAt: new Date(),
      });
    } else {
      return res.status(400).json({
        message: "Invalid action",
        error: true,
        success: false,
      });
    }

    const savedLead = await lead.save();

    return res.json({
      message: action === "status" ? "Status updated" : "Follow-up added",
      data: savedLead,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error updating lead:", error);
    return res.status(400).json({
      message: error.message || "Failed to update lead",
      error: true,
      success: false,
    });
  }
};

module.exports = updateLeadController;
