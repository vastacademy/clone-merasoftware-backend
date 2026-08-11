const bcrypt = require("bcryptjs");
const userModel = require("../../models/userModel");
const { STORE_PLAIN_PASSWORD } = require("../../config/accessControlConfig");

// Admin-only: sets a new password for a client. Updates the bcrypt hash (the
// real auth source) and, when the feature flag is on, the plaintext copy too.
// Same hashing approach as userSignUp/setNewPassword — no separate auth system.
const resetClientPasswordController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        message: "Password must be at least 4 characters long",
        error: true,
        success: false,
      });
    }

    const user = await userModel.findById(customerId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    const salt = bcrypt.genSaltSync(10);
    user.password = bcrypt.hashSync(newPassword, salt);
    // Admin set this password deliberately, so no forced first-login reset.
    user.mustResetPassword = false;
    if (STORE_PLAIN_PASSWORD) {
      user.plainPassword = newPassword;
    }
    await user.save();

    return res.json({
      message: "Password reset successfully",
      success: true,
      error: false,
      data: { email: user.email, newPassword },
    });
  } catch (error) {
    console.error("Error resetting client password:", error);
    return res.status(500).json({
      message: error.message || "Failed to reset password",
      error: true,
      success: false,
    });
  }
};

module.exports = resetClientPasswordController;
