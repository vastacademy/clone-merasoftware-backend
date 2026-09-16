const mongoose = require("mongoose");

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

const encodeExternalUploadHistoryCursor = (link) => Buffer.from(JSON.stringify({
  createdAt: new Date(link.createdAt).toISOString(),
  id: String(link._id),
})).toString("base64url");

const decodeExternalUploadHistoryCursor = (value) => {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime()) || !mongoose.isValidObjectId(parsed.id)) throw new Error();
    return { createdAt, id: new mongoose.Types.ObjectId(parsed.id) };
  } catch {
    throw new Error("Invalid upload-link history cursor");
  }
};

const getExternalUploadHistoryLimit = (value) => {
  if (value === undefined) return DEFAULT_HISTORY_LIMIT;
  if (!/^\d+$/.test(String(value))) throw new Error("Invalid upload-link history limit");
  const parsed = Number(value);
  if (parsed < 1) throw new Error("Invalid upload-link history limit");
  return Math.min(parsed, MAX_HISTORY_LIMIT);
};

module.exports = {
  encodeExternalUploadHistoryCursor,
  decodeExternalUploadHistoryCursor,
  getExternalUploadHistoryLimit,
  DEFAULT_HISTORY_LIMIT,
  MAX_HISTORY_LIMIT,
};
