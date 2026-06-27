// FileName: controller/user/getUserKycStatusController.js
const userModel = require("../../models/userModel");

async function getUserKycStatusController(req, res) {
  try {
    const userId = req.userId; // From authToken middleware

    const user = await userModel
      .findById(userId)
      .select(
        "userDetails.isDetailsCompleted userDetails.kycStatus userDetails.kycRejectionReasons userDetails.kycApprovedAt userDetails.kycRejectedAt"
      );

    if (!user) {
      throw new Error("User not found.");
    }

    res.status(200).json({
      data: user.userDetails,
      success: true,
      error: false,
      message: "User KYC status fetched successfully!",
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

module.exports = getUserKycStatusController;
