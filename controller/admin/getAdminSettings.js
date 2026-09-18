const AdminSettings = require("../../models/adminSettingsModel");

const getAdminSettingsController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const settings = await AdminSettings.getSettings();

    return res.json({
      message: "Admin settings fetched",
      data: settings,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error fetching admin settings:", error);
    return res.status(400).json({
      message: error.message || "Failed to fetch admin settings",
      error: true,
      success: false,
    });
  }
};

module.exports = getAdminSettingsController;
