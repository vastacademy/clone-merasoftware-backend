const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const userModel = require("../../models/userModel");
const leadModel = require("../../models/leadModel");
const purgeExpiredGuests = require("../../helpers/purgeExpiredGuests");

const GUEST_INACTIVITY_MS = 24 * 60 * 60 * 1000;

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
    // guest matching this email/phone doesn't get treated as still-alive.
    await purgeExpiredGuests();

    const cutoff = new Date(Date.now() - GUEST_INACTIVITY_MS);

    // Cross-device resume: same person (email AND phone both match) with a
    // still-alive guest account resumes it instead of getting a new one.
    const existingLead = await leadModel.findOne({
      source: "guest",
      email: cleanEmail,
      phone: cleanPhone,
      guestUserId: { $ne: null },
    });

    if (existingLead?.guestUserId) {
      const existingGuest = await userModel.findOne({
        _id: existingLead.guestUserId,
        isGuest: true,
        $or: [{ lastActivityAt: { $gte: cutoff } }, { lastActivityAt: null, createdAt: { $gte: cutoff } }],
      });

      if (existingGuest) {
        existingGuest.lastActivityAt = new Date();
        await existingGuest.save();
        issueLoginCookie(res, existingGuest);

        return res.status(200).json({
          message: "Guest session resumed",
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
    }

    // No live guest to resume — create a fresh lead + guest account together.
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
