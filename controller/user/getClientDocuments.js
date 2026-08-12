const buildClientDocumentsTimeline = require("../../helpers/clientDocumentsTimeline");

// Customer-facing: returns every admin-sent document for the logged-in client in
// one newest-first timeline (userModel.documents[] + converted-lead proposals[]).
// The merge logic lives in the shared helper so the admin side returns the exact
// same shape. This endpoint only reads; it owns no data. Nothing but admin-sent
// files appears here.
const getClientDocuments = async (req, res) => {
  try {
    const documents = await buildClientDocumentsTimeline(req.userId);

    if (documents === null) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    return res.status(200).json({
      message: "Documents fetched successfully",
      data: { documents },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error fetching client documents:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch documents",
      error: true,
      success: false,
    });
  }
};

module.exports = getClientDocuments;
