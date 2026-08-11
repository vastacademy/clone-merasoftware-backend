/**
 * One-time cleanup: remove the stored plaintext password from every user.
 *
 * Use this when disabling the admin password-view feature:
 *   1) Set STORE_PLAIN_PASSWORD = false in config/accessControlConfig.js
 *      (stops any new plaintext from being written).
 *   2) Run this script to unset `plainPassword` from all existing users.
 *
 * The bcrypt hash (real auth source) is untouched — logins keep working and
 * no user is affected. Run from the backend folder:
 *   node scripts/removePlainPasswords.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../models/userModel");

async function run() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set. Aborting.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected. Removing plainPassword from all users...");

  const result = await userModel.updateMany(
    { plainPassword: { $exists: true } },
    { $unset: { plainPassword: "" } }
  );

  console.log(
    `Done. Matched: ${result.matchedCount ?? result.n}, Modified: ${
      result.modifiedCount ?? result.nModified
    }`
  );

  await mongoose.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error("Cleanup failed:", err);
  process.exit(1);
});
