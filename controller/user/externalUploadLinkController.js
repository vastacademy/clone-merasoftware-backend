const externalUploadLinkModel = require("../../models/externalUploadLinkModel");
const userModel = require("../../models/userModel");
const { resolveEligibleUploadTarget } = require("../../helpers/externalUploadLinkPolicy");
const {
  createExternalUploadToken,
  digestExternalUploadToken,
  buildExternalUploadUrl,
} = require("../../helpers/externalUploadToken");
const {
  encodeExternalUploadHistoryCursor,
  decodeExternalUploadHistoryCursor,
  getExternalUploadHistoryLimit,
} = require("../../helpers/externalUploadHistoryCursor");

const adminOnly = (req, res) => req.userRole === "admin" || (res.status(403).json({ success: false, error: true, message: "Forbidden" }), false);

const list = async (req, res) => { try {
  if (!adminOnly(req, res)) return;
  const limit = getExternalUploadHistoryLimit(req.query.limit);
  const cursor = req.query.cursor ? decodeExternalUploadHistoryCursor(req.query.cursor) : null;
  const filter = { customerId: req.params.customerId };
  if (cursor) {
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }

  const rows = await externalUploadLinkModel.find(filter)
    .select("customerId orderId mode status useCount createdAt revokedAt lastUsedAt")
    .populate("orderId", "isWebsiteProject isServicePlan projectSnapshot servicePlanSnapshot orderItems")
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length ? encodeExternalUploadHistoryCursor(items[items.length - 1]) : null;
  res.json({ success: true, error: false, data: { items, nextCursor } });
} catch (error) { res.status(400).json({ success: false, error: true, message: error.message }); } };

const generate = async (req, res) => { try {
  if (!adminOnly(req, res)) return;
  const { customerId } = req.params;
  const { orderId, mode } = req.body || {};
  if (!orderId || !["single", "multiple"].includes(mode)) throw new Error("Select a record and link mode");
  await resolveEligibleUploadTarget({ customerId, orderId });
  const token = createExternalUploadToken();
  const publicUrl = buildExternalUploadUrl(token);
  const link = await externalUploadLinkModel.create({ customerId, orderId, tokenDigest: digestExternalUploadToken(token), mode, generatedBy: req.userId, status: "pending" });
  const now = new Date();
  const previous = await externalUploadLinkModel.findOneAndUpdate(
    {
      customerId,
      orderId,
      status: "active",
      $or: [{ reservationId: null }, { reservationExpiresAt: { $lte: now } }],
    },
    { $set: { status: "replaced", replacedBy: link._id } },
    { new: true },
  );
  try {
    link.status = "active";
    await link.save();
  } catch (activationError) {
    await externalUploadLinkModel.deleteOne({ _id: link._id, status: "pending" });
    if (previous) {
      const currentActive = await externalUploadLinkModel.exists({ customerId, orderId, status: "active" });
      if (!currentActive) {
        await externalUploadLinkModel.updateOne(
          { _id: previous._id, status: "replaced", replacedBy: link._id },
          { $set: { status: "active", replacedBy: null } },
        );
      } else {
        await externalUploadLinkModel.updateOne(
          { _id: previous._id, status: "replaced", replacedBy: link._id },
          { $set: { replacedBy: currentActive._id } },
        );
      }
    }
    throw activationError;
  }
  res.set("Cache-Control", "no-store");
  res.status(201).json({ success: true, error: false, data: { id: String(link._id), orderId: String(orderId), mode, publicUrl } });
} catch (error) {
  const status = error?.code === 11000 ? 409 : 400;
  const message = status === 409 ? "Another upload link generation is already in progress" : error.message;
  res.status(status).json({ success: false, error: true, message });
} };

const revoke = async (req, res) => { try {
  if (!adminOnly(req, res)) return;
  const now = new Date();
  const link = await externalUploadLinkModel.findOneAndUpdate({
    _id: req.params.linkId,
    customerId: req.params.customerId,
    status: "active",
    $or: [{ reservationId: null }, { reservationExpiresAt: { $lte: now } }],
  }, { $set: { status: "revoked", revokedAt: now } }, { new: true });
  if (!link) throw new Error("Active upload link not found");
  res.json({ success: true, error: false, data: { id: String(link._id), status: link.status } });
} catch (error) { res.status(400).json({ success: false, error: true, message: error.message }); } };

const updatePreference = async (req, res) => { try {
  if (req.userRole !== "customer") return res.status(403).json({ success: false, error: true, message: "Forbidden" });
  const enabled = req.body?.allowLoginFreeUploadLinks;
  if (typeof enabled !== "boolean") throw new Error("A valid upload-link preference is required");
  const user = await userModel.findOneAndUpdate(
    { _id: req.userId, isGuest: { $ne: true }, deletedAt: null, isActive: { $ne: false } },
    {
      $set: { allowLoginFreeUploadLinks: enabled },
      $push: { uploadLinkConsentHistory: { $each: [{ enabled, changedAt: new Date() }], $slice: -50 } },
    },
    { new: true },
  ).select("allowLoginFreeUploadLinks");
  if (!user) throw new Error("Client not found");
  res.json({ success: true, error: false, data: { allowLoginFreeUploadLinks: user.allowLoginFreeUploadLinks } });
} catch (error) { res.status(400).json({ success: false, error: true, message: error.message }); } };

module.exports = { list, generate, revoke, updatePreference };
