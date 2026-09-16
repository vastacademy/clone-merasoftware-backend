const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const userModel = require("../models/userModel");

const COOKIE_NAME = "externalUploadSession";
const PURPOSE = "external_upload";
const ISSUER = "merasoftware-api";
const AUDIENCE = "external-upload";
const SESSION_STAGE = Object.freeze({ CHALLENGE: "challenge", ACCESS: "access" });
const AUTH_MODE = Object.freeze({ LINK: "link", CREDENTIALS: "credentials" });
const SESSION_TTL_MS = 15 * 60 * 1000;

const getSecret = () => {
  const value = process.env.EXTERNAL_UPLOAD_TOKEN_SECRET;
  if (typeof value !== "string" || value.length < 32) {
    throw new Error("EXTERNAL_UPLOAD_TOKEN_SECRET must contain at least 32 characters");
  }
  return value;
};

const getCookieOptions = () => {
  const isDevelopment = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
  const options = {
    httpOnly: true,
    secure: !isDevelopment,
    sameSite: isDevelopment ? "Lax" : "None",
    path: "/api/external-upload",
  };
  if (process.env.COOKIE_DOMAIN) options.domain = process.env.COOKIE_DOMAIN;
  return options;
};

const verifyClientCredentials = async ({ customerId, email, password }) => {
  const user = await userModel.findOne({ _id: customerId, email: String(email || "").trim().toLowerCase() })
    .select("password isActive isGuest deletedAt mustResetPassword");
  if (!user || user.isGuest || user.deletedAt || user.isActive === false || user.mustResetPassword) return false;
  return bcrypt.compare(String(password || ""), user.password || "");
};

const issueExternalUploadSession = ({ res, linkId, customerId, orderId, stage, authMode = null }) => {
  if (!Object.values(SESSION_STAGE).includes(stage)) throw new Error("Invalid external upload session stage");
  if (stage === SESSION_STAGE.ACCESS && !Object.values(AUTH_MODE).includes(authMode)) {
    throw new Error("Invalid external upload authentication mode");
  }
  if (stage === SESSION_STAGE.CHALLENGE && authMode !== null) {
    throw new Error("A challenge session cannot carry an authentication mode");
  }

  const token = jwt.sign(
    { purpose: PURPOSE, linkId: String(linkId), customerId: String(customerId), orderId: String(orderId), stage, authMode },
    getSecret(),
    { expiresIn: "15m", issuer: ISSUER, audience: AUDIENCE },
  );
  res.cookie(COOKIE_NAME, token, { ...getCookieOptions(), maxAge: SESSION_TTL_MS });
};

const readExternalUploadSession = (req) => {
  const signingSecret = getSecret();
  try {
    const decoded = jwt.verify(req.cookies?.[COOKIE_NAME], signingSecret, { issuer: ISSUER, audience: AUDIENCE });
    if (decoded?.purpose !== PURPOSE || !Object.values(SESSION_STAGE).includes(decoded.stage)) return null;
    if (decoded.stage === SESSION_STAGE.ACCESS && !Object.values(AUTH_MODE).includes(decoded.authMode)) return null;
    if (decoded.stage === SESSION_STAGE.CHALLENGE && decoded.authMode !== null) return null;
    if (!decoded.linkId || !decoded.customerId || !decoded.orderId) return null;
    return decoded;
  } catch {
    return null;
  }
};

const clearExternalUploadSession = (res) => res.clearCookie(COOKIE_NAME, getCookieOptions());

module.exports = {
  verifyClientCredentials,
  issueExternalUploadSession,
  readExternalUploadSession,
  clearExternalUploadSession,
  COOKIE_NAME,
  SESSION_STAGE,
  AUTH_MODE,
};
