const bcrypt = require("bcryptjs");
const leadModel = require("../../models/leadModel");
const userModel = require("../../models/userModel");
const { STORE_PLAIN_PASSWORD } = require("../../config/accessControlConfig");
const { executeGuestCascadeDelete } = require("../../helpers/guestCascadeDelete");

// Universal default password given to a converted lead. The customer is
// prompted to set their own on first login (mustResetPassword flag).
const UNIVERSAL_DEFAULT_PASSWORD = "1234";

const convertLeadController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { leadId } = req.params;

    const lead = await leadModel.findById(leadId);
    if (!lead) {
      return res.status(404).json({
        message: "Lead not found",
        error: true,
        success: false,
      });
    }

    if (lead.convertedToUserId) {
      return res.status(409).json({
        message: "This lead is already converted to a client",
        error: true,
        success: false,
      });
    }

    const cleanPhone = (lead.phone || "").trim();
    const cleanEmail = (lead.email || "").trim().toLowerCase();

    if (!cleanPhone) {
      return res.status(400).json({
        message: "This lead has no phone number. Add a phone before converting.",
        error: true,
        success: false,
      });
    }

    if (!cleanEmail) {
      return res.status(400).json({
        message: "This lead has no email. An email is required to create a client account.",
        error: true,
        success: false,
      });
    }

    // Existing-user guard (same email cannot become a second account) — unless
    // the existing user IS this lead's own live guest account. A guest shares
    // its lead's exact email/phone (requirement of the guest login system), so
    // without this exception every guest-originated lead would be wrongly
    // rejected here as "already exists". The guest account is cascade-deleted
    // before the real account is created below, since userModel.email has a
    // hard unique index — both cannot exist at once.
    const existingUser = await userModel.findOne({ email: cleanEmail });
    if (existingUser) {
      const isOwnGuest =
        lead.guestUserId && String(existingUser._id) === String(lead.guestUserId);

      if (!isOwnGuest) {
        return res.status(409).json({
          message: "A user with this email already exists. Cannot convert.",
          error: true,
          success: false,
        });
      }

      await executeGuestCascadeDelete(existingUser._id);
      lead.guestUserId = null;
    }

    // Reuse the same hashing approach as userSignUp.
    const salt = bcrypt.genSaltSync(10);
    const hashPassword = bcrypt.hashSync(UNIVERSAL_DEFAULT_PASSWORD, salt);

    const newUser = new userModel({
      name: lead.name,
      email: cleanEmail,
      phone: cleanPhone,
      password: hashPassword,
      roles: ["customer"],
      walletBalance: 0,
      referredBy: null,
      referrals: [],
      mustResetPassword: true,
      ...(STORE_PLAIN_PASSWORD ? { plainPassword: UNIVERSAL_DEFAULT_PASSWORD } : {}),
    });

    const savedUser = await newUser.save();

    // Link the lead to the created user and mark it Won.
    lead.convertedToUserId = savedUser._id;
    lead.status = "Won";
    await lead.save();

    return res.json({
      message: "Lead converted to client successfully",
      data: {
        userId: savedUser._id,
        email: savedUser.email,
        defaultPassword: UNIVERSAL_DEFAULT_PASSWORD,
      },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error converting lead:", error);
    return res.status(400).json({
      message: error.message || "Failed to convert lead",
      error: true,
      success: false,
    });
  }
};

module.exports = convertLeadController;
