const mongoose = require("mongoose");
const messageTemplateModel = require("../models/messageTemplateModel");
const connectDB = require("../config/db");
require("dotenv").config();

const DEFAULT_TEMPLATES = [
  { name: "Progress Update", message: "Your project has moved forward. We are continuing work on the selected node(s)." },
  { name: "Node Completed", message: "The selected node(s) have been completed successfully." },
  { name: "Ready for Review", message: "The selected work is ready for your review. Please share any feedback." },
];

const seedDefaultMessageTemplates = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");

    const existingCount = await messageTemplateModel.countDocuments();
    if (existingCount > 0) {
      console.log(`ℹ️ ${existingCount} message template(s) already exist — skipping seed.`);
      process.exit(0);
    }

    const created = await messageTemplateModel.insertMany(DEFAULT_TEMPLATES);
    console.log(`✅ Seeded ${created.length} default message templates.`);
    console.log("🎉 Seed completed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Seed error:", err);
    process.exit(1);
  }
};

seedDefaultMessageTemplates();
