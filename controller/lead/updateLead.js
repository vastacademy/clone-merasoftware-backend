const path = require("path");
const leadModel = require("../../models/leadModel");
const GoogleDriveService = require("../../helpers/googleDriveService");

const ALLOWED_STATUSES = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];

// Path to the Google Drive credentials file (same resolution as uploadProposal.js).
let KEY_FILE_PATH;
if (process.env.NODE_ENV === "production" && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  KEY_FILE_PATH = path.join(__dirname, "../../config/google-drive-credentials.json");
}
const FOLLOWUP_FOLDER_NAME = "LeadFollowUpFiles";

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

    // Unified follow-up: one entry carries a pipeline-stage badge, a mandatory
    // remark, and an optional file. Adding the follow-up also moves the lead's
    // own status to the chosen badge (the two are merged into one action).
    if (action === "followUp") {
      const badge = (req.body.badge || "").trim();
      if (!ALLOWED_STATUSES.includes(badge)) {
        return res.status(400).json({
          message: "Please select a valid stage badge",
          error: true,
          success: false,
        });
      }

      const note = (req.body.note || "").trim();
      if (!note) {
        return res.status(400).json({
          message: "Please provide a follow-up note",
          error: true,
          success: false,
        });
      }

      // Optional attachment: upload to Google Drive only when a file is present.
      let attachment = null;
      const file = (req.files && req.files[0]) || null;
      if (file) {
        const driveService = new GoogleDriveService(KEY_FILE_PATH, FOLLOWUP_FOLDER_NAME);
        const folderId = await driveService.createFolder();

        const fileBuffer = Buffer.from(file.buffer);
        const safeFilename = file.originalname.replace(/\s+/g, "_");

        const uploadedFile = await driveService.uploadFile(
          safeFilename,
          fileBuffer,
          file.mimetype,
          folderId
        );

        attachment = {
          name: safeFilename,
          driveFileId: uploadedFile.id,
          downloadLink: driveService.getDownloadLink(uploadedFile.id),
          type: file.mimetype,
          size: file.size,
        };
      }

      lead.followUps.push({
        note,
        badge,
        attachment,
        date: new Date(),
        createdBy: req.userId,
        createdAt: new Date(),
      });

      // Merge: the lead's current pipeline stage follows the latest follow-up badge.
      lead.status = badge;

      const savedLead = await lead.save();

      return res.json({
        message: "Follow-up added",
        data: savedLead,
        success: true,
        error: false,
      });
    }

    return res.status(400).json({
      message: "Invalid action",
      error: true,
      success: false,
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
