const userModel = require("../../models/userModel");

// Admin-only: enable/disable a client's login by toggling `isActive`.
// When false, userSignIn blocks login after a successful password match.
const updateClientAccountStatusController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "isActive (boolean) is required",
        error: true,
        success: false,
      });
    }

    // Guard: an admin cannot disable their own account.
    if (customerId === String(req.userId) && isActive === false) {
      return res.status(400).json({
        message: "You cannot disable your own account.",
        error: true,
        success: false,
      });
    }

    const user = await userModel.findById(customerId).select("isActive email roles");
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    // Guard: do not allow disabling an admin account through this endpoint.
    if (isActive === false && Array.isArray(user.roles) && user.roles.includes("admin")) {
      return res.status(400).json({
        message: "Admin accounts cannot be disabled here.",
        error: true,
        success: false,
      });
    }

    user.isActive = isActive;
    await user.save();

    return res.json({
      message: isActive ? "Account enabled" : "Account disabled",
      success: true,
      error: false,
      data: { isActive: user.isActive },
    });
  } catch (error) {
    console.error("Error updating client account status:", error);
    return res.status(500).json({
      message: error.message || "Failed to update account status",
      error: true,
      success: false,
    });
  }
};

module.exports = updateClientAccountStatusController;
