const userModel = require("../models/userModel");
const { executeGuestCascadeDelete } = require("./guestCascadeDelete");

const GUEST_INACTIVITY_MS = 24 * 60 * 60 * 1000;

// Lazy purge, same pattern as controller/trash/getTrash.js: no cron anywhere in
// this codebase deletes users, so expired guests are cleaned up opportunistically
// whenever this is called (admin Clients list load, guest-login/resume attempts).
// A guest with a live chess game is skipped this pass (executeGuestCascadeDelete
// refuses it) and will be picked up on a later call once the game ends.
const purgeExpiredGuests = async () => {
  const cutoff = new Date(Date.now() - GUEST_INACTIVITY_MS);

  const expiredGuests = await userModel
    .find({
      isGuest: true,
      $or: [{ lastActivityAt: { $lt: cutoff } }, { lastActivityAt: null, createdAt: { $lt: cutoff } }],
    })
    .select("_id");

  let purgedCount = 0;
  for (const guest of expiredGuests) {
    try {
      const result = await executeGuestCascadeDelete(guest._id);
      if (result.deleted) purgedCount += 1;
    } catch (error) {
      console.error("Error purging expired guest:", guest._id.toString(), error.message);
    }
  }

  return { checked: expiredGuests.length, purged: purgedCount };
};

module.exports = purgeExpiredGuests;
