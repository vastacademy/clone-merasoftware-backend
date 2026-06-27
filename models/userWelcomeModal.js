const mongoose = require('mongoose');

const userWelcomeSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    description: String,
    cta: {
        text: String,
        link: String
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

userWelcomeSchema.index({ isActive: 1 });
const UserWelcome = mongoose.model('UserWelcome', userWelcomeSchema);
module.exports = UserWelcome;