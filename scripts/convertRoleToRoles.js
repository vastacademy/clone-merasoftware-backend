const mongoose = require("mongoose");
const User = require("../models/userModel"); // adjust path if needed
const connectDB = require("../config/db");
require("dotenv").config();

const migrateRoleField = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");

    const usersWithOldRole = await User.find({
      role: { $exists: true },
      roles: { $exists: false },
    });

    console.log(`🔍 Found ${usersWithOldRole.length} users to migrate`);

    for (let user of usersWithOldRole) {
      user.roles = [user.role];
      user.role = undefined;
      await user.save();
      console.log(`✅ Updated ${user.email} → roles: [${user.roles[0]}]`);
    }

    console.log("🎉 Migration completed.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration error:", err);
    process.exit(1);
  }
};

migrateRoleField();