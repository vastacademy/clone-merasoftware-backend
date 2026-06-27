const mongoose = require('mongoose');

const guestSlidesSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    subtitle: String,
    description: String,
    ctaButtons: [{
        text: String,
        link: String,
        type: {
            type: String,
            enum: ['primary', 'secondary']
        }
    }],
    isActive: {
        type: Boolean,
        default: true
    },
    displayOrder: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

guestSlidesSchema.index({ isActive: 1, displayOrder: 1 });
const GuestSlides = mongoose.model('GuestSlides', guestSlidesSchema);
module.exports = GuestSlides;