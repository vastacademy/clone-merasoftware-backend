const AdminSettings = require("../../models/adminSettingsModel");

// Only fields explicitly listed here can be updated through this endpoint —
// an allowlist so a stray/unexpected body key can never write to a settings
// field this route wasn't meant to expose.
const UPDATABLE_FIELDS = ["leadReferralRewardAmount"];

const updateAdminSettingsController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const updates = {};

    if (req.body.leadReferralRewardAmount !== undefined) {
      const amount = Number(req.body.leadReferralRewardAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({
          message: "Lead referral reward amount must be a non-negative number",
          error: true,
          success: false,
        });
      }
      updates.leadReferralRewardAmount = amount;
    }

    const hasUpdatableField = UPDATABLE_FIELDS.some((field) => updates[field] !== undefined);
    if (!hasUpdatableField) {
      return res.status(400).json({
        message: "No valid settings provided to update",
        error: true,
        success: false,
      });
    }

    const settings = await AdminSettings.getSettings();
    Object.assign(settings, updates);
    await settings.save();

    return res.json({
      message: "Admin settings updated",
      data: settings,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error updating admin settings:", error);
    return res.status(400).json({
      message: error.message || "Failed to update admin settings",
      error: true,
      success: false,
    });
  }
};

module.exports = updateAdminSettingsController;
