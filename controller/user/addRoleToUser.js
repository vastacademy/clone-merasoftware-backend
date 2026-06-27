const userModel = require("../../models/userModel");

async function addRoleToUserController(req, res) {
  try {
    const { userId, role } = req.body;

    if (!userId) {
      throw new Error("User ID is required");
    }
    if (!role) {
      throw new Error("Role is required");
    }

    const user = await userModel.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const roleLower = role.toLowerCase();

    if (user.roles.includes(roleLower)) {
      throw new Error("User already has this role");
    }

    user.roles.push(roleLower);
    await user.save();

    res.status(200).json({
      success: true,
      error: false,
      message: "Role added to user successfully",
      data: user,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: true,
      message: err.message || "Failed to add role to user",
    });
  }
}

module.exports = addRoleToUserController;
