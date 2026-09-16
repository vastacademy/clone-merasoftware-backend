const crypto = require("crypto");

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PUBLIC_ROUTE = "/external-upload";

const normalizeToken = (token) => {
  const value = typeof token === "string" ? token.trim() : "";
  if (!TOKEN_PATTERN.test(value)) throw new Error("Invalid upload link");
  return value;
};

const createExternalUploadToken = () => crypto.randomBytes(TOKEN_BYTES).toString("base64url");

const digestExternalUploadToken = (token) => (
  crypto.createHash("sha256").update(normalizeToken(token)).digest("hex")
);

const getPublicPortalOrigin = () => {
  const configuredOrigin = process.env.FORNTEND_URL;

  if (!configuredOrigin) throw new Error("FORNTEND_URL is not configured");

  let parsed;
  try {
    parsed = new URL(configuredOrigin);
  } catch {
    throw new Error("FORNTEND_URL is invalid");
  }

  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) {
    throw new Error("FORNTEND_URL must use HTTPS");
  }
  if (parsed.username || parsed.password) throw new Error("FORNTEND_URL is invalid");

  return parsed.origin;
};

const buildExternalUploadUrl = (token) => {
  const safeToken = normalizeToken(token);
  const url = new URL(PUBLIC_ROUTE, getPublicPortalOrigin());
  url.hash = new URLSearchParams({ token: safeToken }).toString();
  return url.toString();
};

module.exports = {
  createExternalUploadToken,
  digestExternalUploadToken,
  buildExternalUploadUrl,
  normalizeExternalUploadToken: normalizeToken,
  PUBLIC_ROUTE,
};
