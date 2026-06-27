const mongoose = require("mongoose");
const Product = require("../models/productModel"); // Adjust path if needed
const connectDB = require("../config/db");
require("dotenv").config();

const migrateAddIsHiddenField = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");

    const result = await Product.updateMany(
      { isHidden: { $exists: false } },
      { $set: { isHidden: false } }
    );

    console.log(`✅ Updated ${result.modifiedCount} products → isHidden: false`);
    console.log("🎉 Migration completed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration error:", err);
    process.exit(1);
  }
};

migrateAddIsHiddenField();
