const userModel = require("../../models/userModel");

const RESULT_LIMIT = 10;

// Escape user input so it is treated as literal text in the regex, not a pattern.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Admin-only customer search used by the Add Lead "Reference" flow to find and
// link an existing customer. Deliberately separate from globalSearch.js (which
// also returns leads) so this stays customer-only and lightweight.
const searchCustomersController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const query = (req.query.q || "").trim();
    if (!query) {
      return res.json({
        message: "Empty query",
        data: [],
        success: true,
        error: false,
      });
    }

    const regex = new RegExp(escapeRegex(query), "i");

    const customers = await userModel
      .find({
        roles: "customer",
        deletedAt: null,
        isGuest: { $ne: true },
        $or: [{ name: regex }, { email: regex }, { phone: regex }],
      })
      .select("name email phone")
      .limit(RESULT_LIMIT)
      .lean();

    return res.json({
      message: "Search results",
      data: customers,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error searching customers:", error);
    return res.status(400).json({
      message: error.message || "Search failed",
      error: true,
      success: false,
    });
  }
};

module.exports = searchCustomersController;
