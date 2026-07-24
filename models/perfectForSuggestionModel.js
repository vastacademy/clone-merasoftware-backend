const mongoose = require('mongoose');

const perfectForSuggestionSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    icon: {
        type: String,
        required: true
    },
    usageCount: {
        type: Number,
        default: 1
    }
}, {
    timestamps: true
});

const PerfectForSuggestion = mongoose.model('PerfectForSuggestion', perfectForSuggestionSchema);
module.exports = PerfectForSuggestion;
