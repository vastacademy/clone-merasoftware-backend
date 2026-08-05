const mongoose = require('mongoose');

const categoryBasePriceSchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    unique: true,
    enum: ["standard_websites", "dynamic_websites", "cloud_software_development", "app_development"],
  },
  basePrice: {
    type: Number,
    required: true,
    min: 0,
  },
  description: {
    type: String,
    default: "",
  },
}, {
  timestamps: true,
});

const categoryBasePriceModel = mongoose.model("categoryBasePrice", categoryBasePriceSchema);
module.exports = categoryBasePriceModel;
