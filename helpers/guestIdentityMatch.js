const userModel = require("../models/userModel");
const leadModel = require("../models/leadModel");

// Checks the submitted guest email/phone against BOTH userModel (real customers
// + existing guests) and leadModel (prospects, including guest-originated ones),
// following the same parallel dual-collection pattern as globalSearch.js.
//
// Classification (evidence-based rule, not a guess):
// - "guest_resume": one record has BOTH email and phone matching, and it's a
//   live guest (isGuest:true) -> safe to resume, no real identity risk.
// - "real_user": one record has BOTH matching, and it's a real customer
//   (isGuest:false) -> must NEVER auto-login without a password. Reject.
// - "conflict": some record matches only ONE of email/phone (not both) ->
//   ambiguous, could be a different person who happens to share one field.
//   Reject rather than guess.
// - "none": nothing matches at all -> safe to create a fresh lead + guest.
//
// Guard against leadModel's email/phone defaulting to "" for old admin-created
// leads: only non-empty fields are ever pushed into an $or clause (same
// defensive pattern createLead.js already uses), so this never accidentally
// matches every email-less/phone-less lead.
//
// Known limitation (not fixed here, documented): phone is compared as a raw
// string. No normalization (e.g. +91 prefix, spaces, dashes) exists anywhere
// in this codebase today (verified across createLead.js/convertLead.js too),
// so "9876543210" and "+919876543210" are treated as different numbers.
const findIdentityMatch = async (email, phone) => {
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanPhone = (phone || "").trim();

  if (!cleanEmail && !cleanPhone) {
    return { type: "none" };
  }

  const emailOr = cleanEmail ? [{ email: cleanEmail }] : [];
  const phoneOr = cleanPhone ? [{ phone: cleanPhone }] : [];
  const anyFieldOr = [...emailOr, ...phoneOr];

  const [matchingUsers, matchingLeads] = await Promise.all([
    userModel
      .find({ roles: "customer", $or: anyFieldOr })
      .select("email phone isGuest"),
    leadModel
      .find({ $or: anyFieldOr })
      .select("email phone guestUserId"),
  ]);

  const isBothMatch = (record) =>
    cleanEmail && cleanPhone && record.email === cleanEmail && record.phone === cleanPhone;

  const bothMatchUser = matchingUsers.find(isBothMatch);
  if (bothMatchUser) {
    return bothMatchUser.isGuest
      ? { type: "guest_resume", guestUser: bothMatchUser }
      : { type: "real_user" };
  }

  // A lead matching both fields only matters if it's guest-originated and has
  // a live guest attached — otherwise it still counts as a partial-identity
  // signal (see below), not a resumable account.
  const bothMatchLead = matchingLeads.find(isBothMatch);
  if (bothMatchLead?.guestUserId) {
    const linkedGuest = await userModel.findOne({
      _id: bothMatchLead.guestUserId,
      isGuest: true,
    });
    if (linkedGuest) {
      return { type: "guest_resume", guestUser: linkedGuest };
    }
  }

  // Anything else that matched at all (user or lead, either field) is a
  // partial/ambiguous signal — reject rather than silently create a duplicate
  // or silently merge into someone else's record.
  if (matchingUsers.length > 0 || matchingLeads.length > 0) {
    return { type: "conflict" };
  }

  return { type: "none" };
};

module.exports = { findIdentityMatch };
