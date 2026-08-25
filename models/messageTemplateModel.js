const mongoose = require('mongoose');

const messageTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "user",
  },
}, {
  timestamps: true,
});

const messageTemplateModel = mongoose.model("messageTemplate", messageTemplateSchema);
module.exports = messageTemplateModel;
