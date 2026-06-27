const mongoose = require('mongoose')

const bannerSchema = new mongoose.Schema({
    images: [{
        type: String,
        required: true
    }],
    serviceName: {
        type: String,
        enum: [
            'home',
            'home_second_banner',
            'static_websites',
            'standard_websites',
            'dynamic_websites',
            'website_updates',
            'mobile_apps',
            'web_applications',
            'app_update',
            'feature_upgrades',
        ],
        required: true,
    },
    position: {
        type: String,
        enum: [
            'home',
            'home_second_banner',
            'static_websites',
            'standard_websites',
            'dynamic_websites',
            'website_updates',
            'mobile_apps',
            'web_applications',
            'app_update',
            'feature_upgrades',
        ],
        required: true
    },
    displayOrder: {
        type: Number,
        required: true,
        default: 0,
        validate: {
            validator: function(v) {
                return v >= 0;
            },
            message: 'Display order must be a non-negative number'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    duration: {
        type: Number,
        min: 1,
        max: 30,
        default: 5,
        validate: {
            validator: function(v) {
                return this.position === 'home' ? v >= 1 : true;
            },
            message: 'Duration is required for home position banners'
        }
    },
    targetUrl: {
        type: String,
        default: '',  // Optional URL
        trim: true
    }
}, {
    timestamps: true
});

// Add compound index to ensure unique display order per position
bannerSchema.index({ position: 1, displayOrder: 1 }, { unique: true });

const bannerModel = mongoose.model('Banner', bannerSchema);
module.exports = bannerModel;