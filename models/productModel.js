const mongoose = require('mongoose');

// Checkpoint Schema
const checkpointSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  percentage: {
    type: Number,
    required: true
  }
});

const productSchema = new mongoose.Schema({
    serviceName: String,
    category: String,
    packageIncludes: [String],
    perfectFor: [String],
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
    checkpoints: {
      type: [checkpointSchema],
      validate: {
        validator: function(checkpoints) {
          if (!this.isWebsiteService) return true;
         
          // If it's cloud software development, only validate total percentage
          if (this.category === 'cloud_software_development') {
            const totalPercentage = checkpoints.reduce(
              (sum, checkpoint) => sum + checkpoint.percentage,
              0
            );
            return Math.abs(totalPercentage - 100) < 1; // Allow small floating point errors
          }
          
          // For standard websites, check for required pages
          const requiredPages = [
            "Home Page",
            "About Us Page",
            "Contact Us Page",
            "Gallery Page"
          ];
         
          const hasAllRequiredPages = requiredPages.every(page =>
            checkpoints.some(checkpoint => checkpoint.name === page)
          );
         
          // Total percentage validation
          const totalPercentage = checkpoints.reduce(
            (sum, checkpoint) => sum + checkpoint.percentage,
            0
          );
         
          return hasAllRequiredPages && Math.abs(totalPercentage - 100) < 1;
        },
        message: 'Invalid checkpoints configuration'
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
  }
}, {
    timestamps: true
});

const CLOUD_SOFTWARE_CHECKPOINTS = [
  { name: "Project Initiation", percentage: 4 },                             // 0% to 4%
  { name: "Core Backend & Database Setup", percentage: 2 },                  // 4% to 6% 
  { name: "Server & database architecture setup", percentage: 2 },           // 6% to 8%
  { name: "User roles & authentication system", percentage: 8 },             // 8% to 16%
  { name: "Dashboard structure & data flow design", percentage: 4 },         // 16% to 20%
  { name: "Basic backend functionality setup", percentage: 5 },              // 20% to 25%
  { name: "Core Modules Development", percentage: 5 },                   // 25% to 30%
  { name: "Frontend Development & UI Implementation", percentage: 20 },      // 30% to 50%
  { name: "Dashboard & reports visualization", percentage: 5 },              // 50% to 55%
  { name: "Integration of UI with backend functions", percentage: 20 },      // 55% to 75%
  { name: "Responsive design for mobile & desktop", percentage: 5 },         // 75% to 80%
  { name: "User-friendly navigation & search features", percentage: 2 },     // 80% to 82%
  { name: "Email & SMS Notifications", percentage: 3 },                      // 82% to 85%
  { name: "Role-Based Access Control", percentage: 3 },                      // 85% to 88%
  { name: "Basic Third-Party Integrations", percentage: 4 },                 // 88% to 92%
  { name: "Performance testing across devices", percentage: 2 },             // 92% to 94%
  { name: "Fixing bugs & security updates", percentage: 2 },                 // 94% to 96%
  { name: "User Acceptance Testing (UAT)", percentage: 2 },                  // 96% to 98%
  { name: "Final review & approval by client", percentage: 2 },              // 98% to 100%
  { name: "Deployment & Launch", percentage: 0 }                             // Final step
];

// Set isWebsiteService based on category
productSchema.pre('save', function(next) {
  const websiteCategories = ['standard_websites', 'dynamic_websites'];
  const cloudCategories = ['cloud_software_development', 'app_development'];
  
  this.isWebsiteService = websiteCategories.includes(this.category) || 
                          cloudCategories.includes(this.category);
  this.isFeatureUpgrade = this.category === 'feature_upgrades';
  this.isWebsiteUpdate = this.category === 'website_updates';
  
  // Set default checkpoints for new product based on category
  if (this.isNew && this.isWebsiteService) {
    if (websiteCategories.includes(this.category)) {
      this.setWebsiteCheckpoints();
    } else if (this.category === 'cloud_software_development') {
      this.checkpoints = CLOUD_SOFTWARE_CHECKPOINTS;
    } else if (this.category === 'app_development') {
      // You can define different checkpoints for app development here if needed
      // For now, using cloud software checkpoints
      this.checkpoints = CLOUD_SOFTWARE_CHECKPOINTS;
    }
  }
  
  next();
});

// Add this method to handle website checkpoints
productSchema.methods.setWebsiteCheckpoints = function() {
  const BASE_PAGES = ["Home Page", "About Us Page", "Contact Us Page", "Gallery Page"];
  
  if (this.totalPages >= 4) {
    // Structure checkpoints
    const structureCheckpoints = [
      { name: "Website Structure ready", percentage: 2 },
      { name: "Header created", percentage: 5 },
      { name: "Footer created", percentage: 5 },
    ];

    // Calculate percentage per page
    const remainingPercentage = 78; // 100 - (2 + 5 + 5 + 10)
    const percentagePerPage = Number((remainingPercentage / this.totalPages).toFixed(2));

    // Generate page checkpoints
    const pageCheckpoints = Array.from({ length: this.totalPages }, (_, index) => ({
      name: index < 4 ? BASE_PAGES[index] : `Additional Page ${index - 3}`,
      percentage: percentagePerPage
    }));

    // Final testing checkpoint
    const finalCheckpoint = [{ name: "Final Testing", percentage: 10 }];

    // Combine all checkpoints
    this.checkpoints = [
      ...structureCheckpoints,
      ...pageCheckpoints,
      ...finalCheckpoint
    ];
  }
};

const productModel = mongoose.model("product", productSchema);
module.exports = productModel;