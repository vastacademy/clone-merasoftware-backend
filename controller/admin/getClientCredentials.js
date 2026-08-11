const userModel = require("../../models/userModel");
const { STORE_PLAIN_PASSWORD } = require("../../config/accessControlConfig");

// Admin-only: returns a client's login email, stored plaintext password (if
// available), and account-active state, for the Account & Access section of
// AdminClientWorkspace. Plaintext exists only for users created/reset/logged-in
// after the feature was enabled; older users show `plainPassword: null` until
// their next login backfills it.
const getClientCredentialsController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;

    const user = await userModel
      .findById(customerId)
      .select("email plainPassword isActive mustResetPassword");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        error: true,
        success: false,
      });
    }

    return res.json({
      message: "Credentials fetched",
      success: true,
      error: false,
      data: {
        email: user.email,
        plainPassword: STORE_PLAIN_PASSWORD ? (user.plainPassword || null) : null,
        plainPasswordAvailable: STORE_PLAIN_PASSWORD && !!user.plainPassword,
        isActive: user.isActive !== false,
        mustResetPassword: !!user.mustResetPassword,
      },
    });
  } catch (error) {
    console.error("Error fetching client credentials:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch credentials",
      error: true,
      success: false,
    });
  }
};

module.exports = getClientCredentialsController;
