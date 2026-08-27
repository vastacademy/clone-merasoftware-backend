// One access rule for every uploaded-data surface.
//
// The rule itself is not new — it is the one invoiceDocumentController.js already applies
// to invoice documents: an admin may read anything, everyone else only their own record.
// It lives here so the listing route and the zip route enforce the same sentence rather
// than each restating it, which is how the two could otherwise drift apart and let one
// surface show what the other refuses.

/**
 * May this request read a record owned by `ownerId`?
 * @param {object} req  express request (needs userRole + userId, set by authToken)
 * @param {*} ownerId   the userId the record belongs to
 */
const canReadUpload = (req, ownerId) =>
  req?.userRole === "admin" || String(ownerId || "") === String(req?.userId || "");

/**
 * Same rule, as a guard: returns an { status, body } to send when access is refused,
 * or null when the caller may proceed.
 */
const assertCanReadUpload = (req, ownerId) => {
  if (canReadUpload(req, ownerId)) return null;
  return {
    status: 403,
    body: { message: "Forbidden", error: true, success: false },
  };
};

module.exports = {
  canReadUpload,
  assertCanReadUpload,
};
