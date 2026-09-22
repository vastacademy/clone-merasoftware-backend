/**
 * One-time data migration: give every leadModel.followUps[] entry a permanent _id.
 *
 * Why: 33 of 36 follow-ups were written without a subdocument _id. getLeadDetail
 * serves them with .lean(), so Mongoose never generates one on read and the admin
 * UI receives `_id: undefined`. The edit form then posts the string "undefined",
 * and updateLead's `lead.followUps.id(followUpId)` returns null -> 404
 * "Follow-up not found". Editing any such follow-up is impossible until the _id
 * is persisted, because a hydrated _id is regenerated on every read and never
 * matches what the UI last saw.
 *
 * Safe to re-run: only entries missing _id are touched, and each write is guarded
 * by the document's exact followUps length so a concurrent change aborts it.
 *
 * Usage:
 *   node scripts/backfillFollowUpIds.js           # dry run, writes nothing
 *   node scripts/backfillFollowUpIds.js --apply   # perform the migration
 */
require("dotenv").config();
const mongoose = require("mongoose");

const APPLY = process.argv.includes("--apply");

const run = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is missing in environment variables");

  await mongoose.connect(uri);
  console.log(`Connected to: ${mongoose.connection.name}`);
  console.log(APPLY ? "MODE: APPLY (writing)" : "MODE: DRY RUN (no writes)");

  const leads = mongoose.connection.collection("leads");
  const affected = await leads
    .find({ followUps: { $elemMatch: { _id: { $exists: false } } } })
    .toArray();

  console.log(`Leads with follow-ups missing _id: ${affected.length}`);

  let scanned = 0;
  let filled = 0;
  let updatedLeads = 0;

  for (const lead of affected) {
    const followUps = lead.followUps || [];
    let missingHere = 0;

    // Rewrite the array in place, preserving order and every existing field.
    const nextFollowUps = followUps.map((followUp) => {
      scanned += 1;
      if (followUp._id) return followUp;
      missingHere += 1;
      return { _id: new mongoose.Types.ObjectId(), ...followUp };
    });

    if (!missingHere) continue;
    filled += missingHere;

    console.log(`  ${lead._id} | ${lead.name} | filling ${missingHere}/${followUps.length}`);

    if (!APPLY) continue;

    // Guard: only write if the array still has the exact length we just read,
    // so a follow-up added between read and write aborts this document.
    const result = await leads.updateOne(
      { _id: lead._id, [`followUps.${followUps.length - 1}`]: { $exists: true }, [`followUps.${followUps.length}`]: { $exists: false } },
      { $set: { followUps: nextFollowUps } }
    );

    if (result.modifiedCount !== 1) {
      console.log(`  !! SKIPPED ${lead._id} — document changed since read (matched ${result.matchedCount})`);
      continue;
    }
    updatedLeads += 1;
  }

  console.log("---");
  console.log(`Follow-ups scanned: ${scanned}`);
  console.log(`Follow-ups needing _id: ${filled}`);
  console.log(APPLY ? `Leads updated: ${updatedLeads}` : "Dry run — nothing written.");

  // Verify the end state from the database itself, not from our own counters.
  const remaining = await leads.countDocuments({ followUps: { $elemMatch: { _id: { $exists: false } } } });
  console.log(`Leads still missing a follow-up _id: ${remaining}`);

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
