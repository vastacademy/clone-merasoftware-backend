const userModel = require("../models/userModel");
const leadModel = require("../models/leadModel");

// Shared source of truth for a client's admin-sent documents timeline.
// Two real owners, one merged newest-first view (never merged in the DB):
//   1. userModel.documents[]  -> agreements/documents sent after they became a client
//   2. leadModel.proposals[]  -> proposal/quotation files sent while they were a lead
//     (linked by leadModel.convertedToUserId === this user's _id)
// Read-only. Used by both the customer-facing endpoint (getClientDocuments) and
// the admin client-workspace endpoint (getAdminClientDocuments), so the timeline
// shape stays identical on both sides.
const buildClientDocumentsTimeline = async (userId) => {
  const user = await userModel.findById(userId).select("documents").lean();
  if (!user) return null;

  // 1. Client-level documents (agreements etc.).
  const clientDocs = (user.documents || []).map((doc) => ({
    id: String(doc._id),
    kind: "agreement",
    name: doc.name,
    downloadLink: doc.downloadLink,
    type: doc.type,
    size: doc.size,
    source: doc.source,
    nodeId: doc.nodeId || null,
    orderId: doc.orderId ? String(doc.orderId) : null,
    date: doc.uploadedAt,
  }));

  // 2. Proposals from the lead this client was converted from (if any).
  const lead = await leadModel
    .findOne({ convertedToUserId: userId })
    .select("proposals")
    .lean();

  const proposalDocs = ((lead && lead.proposals) || []).map((p) => ({
    id: `proposal-${p.version}`,
    kind: "proposal",
    name: p.name,
    downloadLink: p.downloadLink,
    type: p.type,
    size: p.size,
    version: p.version,
    date: p.uploadedAt,
  }));

  // One timeline, newest first.
  return [...clientDocs, ...proposalDocs].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
};

module.exports = buildClientDocumentsTimeline;
