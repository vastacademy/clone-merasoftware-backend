// Central config for the admin user-access-control feature.
//
// STORE_PLAIN_PASSWORD controls whether the app also stores each user's
// password in plaintext (`plainPassword` on userModel) so an admin can view it
// from the client workspace. This is the SINGLE switch for the whole feature:
// setting it to `false` immediately stops any new plaintext from being written
// in signup / convert / reset / login-backfill, without touching those files.
//
// To fully remove plaintext later: set this to false, then run
// `backend/scripts/removePlainPasswords.js` to unset the field from every user.
//
// NOTE: storing plaintext means a DB leak exposes real passwords. This was an
// explicit, accepted product decision (owner's website, owner's call).
module.exports = {
  STORE_PLAIN_PASSWORD: true,
};
