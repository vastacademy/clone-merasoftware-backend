const userModel = require("../../models/userModel");

async function getAdminClients(req, res) {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const clients = await userModel
      .find({ roles: "customer" })
      .select("name email phone roles createdAt updatedAt profilePic userDetails walletBalance status referredBy");

    res.json({
      message: "Clients fetched successfully",
      data: clients,
      success: true,
      error: false,
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

module.exports = getAdminClients;
