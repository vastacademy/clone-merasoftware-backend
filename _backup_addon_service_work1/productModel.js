const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    serviceName: String,
    category: String,
    startingNodeTitle: String,
    packageIncludes: [String],
    perfectFor: [{
      text: {
        type: String,
        required: true
      },
      icon: {
        type: String,
        required: true
      }
    }],
    serviceImage: [],
    price: Number,
    sellingPrice: Number,
    formattedDescriptions: [{
      content: {
          type: String,
          required: true
      }
  }],
    
    // Website service fields
    isWebsiteService: {
      type: Boolean,
      default: false
    },
    totalPages: {
      type: Number,
      min: 4,  // Minimum 4 pages (fixed pages)
      max: 50, // Maximum changed to 50 pages
      validate: {
        validator: function(value) {
          return !this.isWebsiteService || (value >= 4 && value <= 50);
        },
        message: 'Website services must have between 4 and 50 pages'
      }
    },
    isFeatureUpgrade: {
      type: Boolean,
      default: false
    },
    
    
    compatibleWith : [String],
    keyBenefits : [String],
    isWebsiteUpdate: {
      type: Boolean,
      default: false
  },
  validityPeriod: {
    type: Number,  // Now storing in days instead of months
    validate: {
      validator: function(value) {
        if (!this.isWebsiteUpdate) return true;
        // Value must be positive and not exceed 365 days (1 year)
        return value > 0 && value <= 365;
      },
      message: 'Website update services must have a valid period between 1 and 365 days'
    }
  },
  updateCount: {
    type: Number,  // Store in months
    validate: {
        validator: function(value) {
            return !this.isWebsiteUpdate || (value > 0);
        },
        message: 'Update count must be greater than 0'
    }
},
  // New fields for yearly renewable plans
  isMonthlyRenewablePlan: {
    type: Boolean,
    default: false
  },
  yearlyPlanDuration: {
    type: Number,  // Total plan duration in days (365)
    validate: {
      validator: function(value) {
        if (!this.isMonthlyRenewablePlan) return true;
        return value > 0 && value <= 365;
      },
      message: 'Yearly plan duration must be between 1 and 365 days'
    }
  },
  monthlyRenewalCost: {
    type: Number,  // Cost for monthly renewal (₹8000)
    validate: {
      validator: function(value) {
        if (!this.isMonthlyRenewablePlan) return true;
        return value > 0;
      },
      message: 'Monthly renewal cost must be greater than 0'
    }
  },
  isUnlimitedUpdates: {
    type: Boolean,
    default: false
  },
  // New fields for monthly limited yearly plans
  isMonthlyLimitedPlan: {
    type: Boolean,
    default: false
  },
  monthlyUpdateLimit: {
    type: Number,  // Updates allowed per month (e.g., 1)
    default: 1,
    validate: {
      validator: function(value) {
        if (!this.isMonthlyLimitedPlan) return true;
        return value > 0;
      },
      message: 'Monthly update limit must be greater than 0'
    }
  },
  monthlyRenewalPrice: {
    type: Number,  // Monthly renewal cost (e.g., ₹3000)
    validate: {
      validator: function(value) {
        if (!this.isMonthlyLimitedPlan) return true;
        return value > 0;
      },
      message: 'Monthly renewal price must be greater than 0'
    }
  },
    additionalFeatures: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'product'  // References the same Product model
  }],
  isHidden: {
    type: Boolean,
    default: false
  },
  isCustomClientProject: {
    type: Boolean,
    default: false
  },
  clientProjectFeatures: [{
    featureId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'product'
    },
    name: String,
    price: Number
  }],

  // ---------------------------------------------------------------------
  // Service Plan System (new, additive). Coexists with the legacy plan
  // fields above — legacy fields/logic are untouched. isServicePlan is the
  // switch every enforcement/read path checks to pick the new vs old path.
  // ---------------------------------------------------------------------
  isServicePlan: {
    type: Boolean,
    default: false
  },
  servicePlan: {
    planType: {
      type: String,
      enum: ['website_updates', 'digital_marketing', 'google_business_setup', 'social_media_marketing', 'other']
    },
    limitScope: {
      type: String,
      enum: ['per_day', 'per_week', 'per_month', 'per_quarter', 'per_6_month', 'per_year', 'per_plan', 'unlimited', 'manual']
    },
    manualUnit: {
      type: String,
      enum: ['day', 'week', 'month']
    },
    manualCount: {
      type: Number,
      min: 1
    },
    portalAccessCount: {
      type: Number,
      min: 1
    },
    filesLimit: {
      type: Number,
      min: 1
    },
    validityUnit: {
      type: String,
      enum: ['day', 'week', 'month', 'year']
    },
    validityValue: {
      type: Number,
      min: 1
    },
    validityInDays: {
      type: Number,
      min: 1
    },
    billingCycle: {
      type: String,
      enum: ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']
    }
  }
}, {
    timestamps: true
});

// Set isWebsiteService/isFeatureUpgrade/isWebsiteUpdate based on category.
// Still used by the node system, feature-product admin pages, and plan detection.
productSchema.pre('save', function(next) {
  const websiteCategories = ['standard_websites', 'dynamic_websites'];
  const cloudCategories = ['cloud_software_development', 'app_development'];

  this.isWebsiteService = websiteCategories.includes(this.category) ||
                          cloudCategories.includes(this.category);
  this.isFeatureUpgrade = this.category === 'feature_upgrades';
  this.isWebsiteUpdate = this.category === 'website_updates';

  next();
});

const productModel = mongoose.model("product", productSchema);
module.exports = productModel;