// Dry-run by default. Pass --apply to actually write.
// Purpose: link the existing "Add New Page" and "Dynamic Page with Panel"
// feature_upgrades products into "College Website" project's
// (67ca8f78b74653ac7d14d6de) additionalFeatures array. Additive only — no
// other field is read or changed.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const productModel = require("../models/productModel");

const COLLEGE_WEBSITE_ID = "67ca8f78b74653ac7d14d6de";
const MISSING_FEATURE_IDS = [
  "67ab511c7bc4940983e09ac9", // Add New Page
  "67a8a84cc46161fd031d6fc6", // Dynamic Page with Panel
];

const isApply = process.argv.includes("--apply");

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const project = await productModel.findById(COLLEGE_WEBSITE_ID);
  if (!project) {
    console.error("College Website project not found. Aborting.");
    await mongoose.disconnect();
    return;
  }

  const currentFeatureIds = project.additionalFeatures.map((id) => id.toString());
  console.log("BEFORE additionalFeatures:", currentFeatureIds);

  const idsToAdd = MISSING_FEATURE_IDS.filter((id) => !currentFeatureIds.includes(id));

  if (idsToAdd.length === 0) {
    console.log("Both features are already linked. Nothing to do.");
    await mongoose.disconnect();
    return;
  }

  const afterFeatureIds = [...currentFeatureIds, ...idsToAdd];
  console.log("AFTER additionalFeatures (would become):", afterFeatureIds);

  if (!isApply) {
    console.log("\nDry run only. Re-run with --apply to write this change.");
    await mongoose.disconnect();
    return;
  }

  const backupDir = path.join(__dirname, "..", "migration-backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `college-website-before-add-new-page-link-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(project.toObject(), null, 2));
  console.log("Backup written to:", backupPath);

  await productModel.updateOne(
    { _id: COLLEGE_WEBSITE_ID },
    { $set: { additionalFeatures: afterFeatureIds } }
  );

  console.log("Applied. College Website now includes:", idsToAdd);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
