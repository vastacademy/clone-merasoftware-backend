// What KIND of upload is this order's "Upload Data" action?
//
// orderUploadHistory.js already records, verified against live data, that an upload
// lands against one of three kinds of order. That knowledge only ever existed as a
// comment there, so the submit path re-derived it with a single boolean
// (`isServicePlan ? service : legacy`) — which has no third answer. A project, being
// `isServicePlan: false`, therefore fell through to the LEGACY branch and was asked
// for the plan template's allowance (productId.updateCount). A project has no plan
// template (productId is null by design), so that read crashed:
//
//   "Cannot read properties of null (reading 'updateCount')"
//
// The fix is not a null guard. It is that the question "which kind of upload is this"
// gets ONE answer, in one place, that every caller asks — the same arrangement
// uploadAccess.js gives the access rule so the listing and zip routes cannot drift.
//
// The three kinds and where each one's allowance actually lives:
//
//   SERVICE — a purchased service plan (standalone, or linked to a project).
//             Allowance is frozen on the order in servicePlanSnapshot
//             (portalAccessCount / filesLimit), never read from the catalogue,
//             so a retired or deleted plan cannot break it.
//
//   PROJECT — the customer's own project during development. Portal access here is
//             UNLIMITED by design: there is no allowance to spend, no counter to
//             increment, and no catalogue row behind it — each project is created
//             for one client. Only the project's own state gates it.
//
//   LEGACY  — the original website_updates plan, whose allowance lived on the
//             catalogue product (updateCount / validityPeriod). Kept because the
//             controller's legacy branch is still present; as of this change no
//             order in the database is of this kind (26 orders: 18 project,
//             8 service, 0 legacy).

const UPLOAD_KIND = {
  SERVICE: "service",
  PROJECT: "project",
  LEGACY: "legacy",
};

/**
 * Which kind of upload does this order take?
 *
 * Decided from the order's own two flags, which live data shows are mutually
 * exclusive and exhaustive (no order has both, none has neither). The catalogue
 * product is deliberately NOT consulted: it can be retired or deleted, and an
 * order must always be able to describe itself.
 *
 * @param {object} order an order document (lean or hydrated)
 * @returns {"service"|"project"|"legacy"}
 */
const getUploadKind = (order) => {
  if (order?.isServicePlan === true) return UPLOAD_KIND.SERVICE;
  if (order?.isWebsiteProject === true) return UPLOAD_KIND.PROJECT;
  return UPLOAD_KIND.LEGACY;
};

const isServiceUpload = (order) => getUploadKind(order) === UPLOAD_KIND.SERVICE;
const isProjectUpload = (order) => getUploadKind(order) === UPLOAD_KIND.PROJECT;
const isLegacyUpload = (order) => getUploadKind(order) === UPLOAD_KIND.LEGACY;

module.exports = {
  UPLOAD_KIND,
  getUploadKind,
  isServiceUpload,
  isProjectUpload,
  isLegacyUpload,
};
