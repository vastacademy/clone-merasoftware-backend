const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
 categoryId: {
   type: String,
   unique: true,
   required: true 
 },
 categoryName: {
   type: String,
   required: true
 },
 categoryValue: {
   type: String,
   required: true,
   unique: true
 },
 serviceType: {
  type: String,
  enum: ['Websites Development', 'Mobile Apps', 'Cloud Softwares', 'Feature Upgrades'],
  required: true
},
description: {
  type: String,
  default: ''
},
 imageUrl: [],
 order: {
   type: Number,
   default: 0
 },
 isActive: {
   type: Boolean,
   default: true
 }
}, {
    timestamps: true
});


const categoryModel = mongoose.model('category', categorySchema);

module.exports = categoryModel