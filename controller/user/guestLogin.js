const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const userModel = require("../../models/userModel");
const leadModel = require("../../models/leadModel");
const purgeExpiredGuests = require("../../helpers/purgeExpiredGuests");
const { findIdentityMatch } = require("../../helpers/guestIdentityMatch");

const issueLoginCookie = (res, user) => {
  const tokenData = { _id: user._id, email: user.email, role: "customer" };
  const token = jwt.sign(tokenData, process.env.TOKEN_SECRET_KEY, { expiresIn: "365d" });
  const tokenOption = {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  };
  if (process.env.COOKIE_DOMAIN) {
    tokenOption.domain = process.env.COOKIE_DOMAIN;
  }
  res.cookie("token", token, tokenOption);
  return token;
};

const guestLoginController = async (req, res) => {
  try {
    const { name, phone, email } = req.body;

    const cleanName = (name || "").trim();
    const cleanPhone = (phone || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanName || !cleanPhone || !cleanEmail) {
      return res.status(400).json({
        message: "Please provide name, phone and email",
        error: true,
        success: false,
      });
    }

    // Opportunistic cleanup before deciding create-vs-resume, so an expired
    // guest matching this email/phone is already gone before the identity
    // check below runs (an expired guest must not block a fresh signup).
    await purgeExpiredGuests();

    // Identity-safety check: never auto-login into a REAL customer's account
    // (no password was collected here), and never guess when only one of
    // email/phone matches something (ambiguous — could be a different
    // person). Only an exact email+phone match on a live guest resumes.
    const match = await findIdentityMatch(cleanEmail, cleanPhone);

    if (match.type === "real_user") {
      return res.status(409).json({
        message: "This email or phone is already registered. Please sign in with your password.",
        outcomeType: "real_user",
        error: true,
        success: false,
      });
    }

    if (match.type === "conflict") {
      return res.status(409).json({
        message: "This email or phone is already in use.",
        outcomeType: "conflict",
        error: true,
        success: false,
      });
    }

    if (match.type === "guest_resume") {
      const existingGuest = match.guestUser;
      existingGuest.lastActivityAt = new Date();
      await existingGuest.save();
      issueLoginCookie(res, existingGuest);

      return res.status(200).json({
        message: "Guest session resumed",
        outcomeType: "guest_resume",
        data: {
          user: {
            _id: existingGuest._id,
            name: existingGuest.name,
            email: existingGuest.email,
            role: "customer",
            isGuest: true,
          },
          walletBalance: existingGuest.walletBalance,
        },
        success: true,
        error: false,
      });
    }

    // match.type === "none" — no live guest to resume, create a fresh lead + guest account together.
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const [lead] = await leadModel.create(
        [
          {
            name: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            source: "guest",
          },
        ],
        { session }
      );

      const randomPassword = crypto.randomBytes(24).toString("hex");
      const hashPassword = bcrypt.hashSync(randomPassword, bcrypt.genSaltSync(10));

      const [guestUser] = await userModel.create(
        [
          {
            name: cleanName,
            phone: cleanPhone,
            email: cleanEmail,
            password: hashPassword,
            roles: ["customer"],
            isGuest: true,
            guestLeadId: lead._id,
            walletBalance: 0,
            lastActivityAt: new Date(),
          },
        ],
        { session }
      );

      lead.guestUserId = guestUser._id;
      await lead.save({ session });

      await session.commitTransaction();

      issueLoginCookie(res, guestUser);

      return res.status(201).json({
        message: "Guest account created",
        outcomeType: "created",
        data: {
          user: {
            _id: guestUser._id,
            name: guestUser.name,
            email: guestUser.email,
            role: "customer",
            isGuest: true,
          },
          walletBalance: guestUser.walletBalance,
        },
        success: true,
        error: false,
      });
    } catch (error) {
      if (session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      await session.endSession();
    }
  } catch (error) {
    console.error("Error in guest login:", error);
    return res.status(400).json({
      message: error.message || "Failed to start guest session",
      error: true,
      success: false,
    });
  }
};

module.exports = guestLoginController;
