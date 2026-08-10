const bcrypt = require("bcryptjs");
const userModel = require("../../models/userModel");

// Lets a logged-in user set a new password (used for the first-login reset
// after a lead is converted with the universal default password).
const setNewPasswordController = async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({
        message: "Password must be at least 4 characters long",
        error: true,
        success: false,
      });
    }

    const user = await userModel.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    const salt = bcrypt.genSaltSync(10);
    user.password = bcrypt.hashSync(newPassword, salt);
    user.mustResetPassword = false;
    await user.save();

    return res.json({
      message: "Password updated successfully",
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error setting new password:", error);
    return res.status(400).json({
      message: error.message || "Failed to update password",
      error: true,
      success: false,
    });
  }
};

module.exports = setNewPasswordController;
