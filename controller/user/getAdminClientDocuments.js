const userModel = require("../../models/userModel");
const buildClientDocumentsTimeline = require("../../helpers/clientDocumentsTimeline");

// Admin-facing: same newest-first documents timeline as the customer sees, for a
// given client, loaded lazily when the admin opens the client-workspace Documents
// tab (mirrors how the Account & Access tab fetches its own data). Reuses the
// shared helper so both sides return the identical shape.
const getAdminClientDocuments = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;

    const client = await userModel.findOne({ _id: customerId, roles: "customer" }).select("_id").lean();
    if (!client) {
      return res.status(404).json({
        message: "Client not found",
        error: true,
        success: false,
      });
    }

    const documents = await buildClientDocumentsTimeline(customerId);

    return res.status(200).json({
      message: "Documents fetched successfully",
      data: { documents: documents || [] },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error fetching admin client documents:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch documents",
      error: true,
      success: false,
    });
  }
};

module.exports = getAdminClientDocuments;
