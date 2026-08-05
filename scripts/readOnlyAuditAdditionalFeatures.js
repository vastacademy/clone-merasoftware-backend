// READ-ONLY audit script. Does not write/update/delete anything.
// Purpose: investigate why "Add New Page" (or any feature_upgrades product) is
// missing from a standard/dynamic website project's Additional Features list.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const productModel = require("../models/productModel");

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const websiteProjects = await productModel
    .find({ category: { $in: ["standard_websites", "dynamic_websites"] } })
    .select("_id serviceName category additionalFeatures isHidden")
    .lean();

  console.log(`\n=== Website projects found: ${websiteProjects.length} ===`);
  websiteProjects.forEach((p) => {
    console.log(
      `- ${p.serviceName} (${p._id}) category=${p.category} isHidden=${p.isHidden} additionalFeatures=${JSON.stringify(
        p.additionalFeatures
      )}`
    );
  });

  const featureUpgrades = await productModel
    .find({ category: "feature_upgrades" })
    .select("_id serviceName compatibleWith isHidden")
    .lean();

  console.log(`\n=== feature_upgrades products found: ${featureUpgrades.length} ===`);
  featureUpgrades.forEach((f) => {
    console.log(
      `- ${f.serviceName} (${f._id}) isHidden=${f.isHidden} compatibleWith=${JSON.stringify(f.compatibleWith)}`
    );
  });

  const addPageFeatures = await productModel
    .find({ category: "feature_upgrades", serviceName: /add.*page/i })
    .select("_id serviceName compatibleWith isHidden")
    .lean();

  console.log(`\n=== Features matching "Add ... Page" name: ${addPageFeatures.length} ===`);
  addPageFeatures.forEach((f) => {
    console.log(JSON.stringify(f, null, 2));
  });

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
