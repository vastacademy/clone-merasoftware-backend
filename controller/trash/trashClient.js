const userModel = require("../../models/userModel");

// Soft-delete a client (userModel, roles: "customer") into Trash. The record stays
// in the collection but is hidden from the clients list + global search (both filter
// deletedAt:null), and login is blocked (isActive:false) while it sits in Trash.
// Restore reverses both. Permanent removal happens via purge (manual or 30-day lazy).
const trashClientController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden", error: true, success: false });
    }

    const { customerId } = req.params;

    // Guard: an admin cannot trash their own account.
    if (String(customerId) === String(req.userId)) {
      return res.status(400).json({
        message: "You cannot delete your own account",
        error: true,
        success: false,
      });
    }

    const user = await userModel.findById(customerId).select("roles deletedAt isActive");
    if (!user) {
      return res.status(404).json({ message: "Client not found", error: true, success: false });
    }

    // Only customers are trashable here — never other admins.
    if (!Array.isArray(user.roles) || !user.roles.includes("customer")) {
      return res.status(400).json({
        message: "Only client accounts can be moved to Trash",
        error: true,
        success: false,
      });
    }

    if (user.deletedAt) {
      return res.status(409).json({
        message: "This client is already in Trash",
        error: true,
        success: false,
      });
    }

    user.deletedAt = new Date();
    user.deletedBy = req.userId;
    user.isActive = false; // block login while trashed
    await user.save();

    return res.json({ message: "Client moved to Trash", success: true, error: false });
  } catch (error) {
    console.error("Error moving client to Trash:", error);
    return res.status(400).json({
      message: error.message || "Failed to move client to Trash",
      error: true,
      success: false,
    });
  }
};

module.exports = trashClientController;
