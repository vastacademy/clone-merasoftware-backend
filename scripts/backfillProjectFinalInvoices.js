// Safe migration for projects that received payments before project_final existed.
// Default is read-only; pass --apply to create/update the missing cumulative records.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const { syncProjectFinalInvoice } = require("../helpers/projectFinalInvoice");
require("../models/userModel");
require("../models/productModel");

const apply = process.argv.includes("--apply");

const run = async () => {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);

  const orders = await orderProductModel.find({
    isWebsiteProject: true,
    paidAmount: { $gt: 0 },
  }).populate("productId", "serviceName");

  console.log(`${apply ? "Applying" : "Dry run"}: ${orders.length} paid project order(s) found.`);
  for (const order of orders) {
    console.log(`${order._id} · paid ${order.paidAmount} · remaining ${order.remainingAmount}`);
    if (apply) await syncProjectFinalInvoice(order);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
