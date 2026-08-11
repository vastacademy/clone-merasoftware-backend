// Shared constants/helpers for the admin Trash (soft-delete) system.
// A trashed record (userModel or leadModel with deletedAt set) is kept for
// TRASH_RETENTION_DAYS, then permanently purged. There is no cron: purge happens
// lazily whenever the Trash list is opened (getTrash), plus manual "Delete Forever".

const TRASH_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// The cutoff before which a trashed record is expired (past retention).
const expiryCutoff = () => new Date(Date.now() - TRASH_RETENTION_DAYS * DAY_MS);

// Whole days remaining before a record is auto-purged (>= 0).
const daysLeft = (deletedAt) => {
  if (!deletedAt) return TRASH_RETENTION_DAYS;
  const purgeAt = new Date(deletedAt).getTime() + TRASH_RETENTION_DAYS * DAY_MS;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / DAY_MS));
};

module.exports = { TRASH_RETENTION_DAYS, expiryCutoff, daysLeft };
