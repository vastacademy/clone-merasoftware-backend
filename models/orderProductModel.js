const mongoose = require('mongoose');

// Message Schema for project communication
const messageSchema = new mongoose.Schema({
    sender: {
        type: String,
        enum: ['admin', 'user'],
        required: true
    },
    message: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    // Add these fields to connect messages to checkpoints
    checkpointId: {
        type: Number
    },
    checkpointName: {
        type: String
    }
});

// Checkpoint progress tracking
const checkpointProgressSchema = new mongoose.Schema({
    checkpointId: {
        type: Number,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    completed: {
        type: Boolean,
        default: false
    },
    completedAt: Date,
    percentage: Number
});

const installmentSchema = new mongoose.Schema({
    installmentNumber: {
        type: Number,
        required: true
    },
    percentage: {
        type: Number,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    paid: {
        type: Boolean,
        default: false
    },
    paymentStatus: {
        type: String,
        enum: ['none', 'pending-approval', 'rejected'],
        default: 'none'
    },
    paidDate: {
        type: Date
    },
    dueDate: {
        type: Date
    },
    transactionId: {
        type: String
    }
});

const orderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        default: 1
    },
    price: {
        type: Number,
        required: true
    },
     // Add coupon-related fields
     couponApplied: {
        type: String,
        default: null
    },
    discountAmount: {
        type: Number,
        default: 0
    },
    originalPrice: {
        type: Number,
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed'],
        default: 'pending'
    },
    projectProgress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    // New fields for project management
    isWebsiteProject: {
        type: Boolean,
        default: false
    },
    checkpoints: [checkpointProgressSchema],
    messages: [messageSchema],
    currentPhase: {
        type: String,
        enum: ['planning', 'development', 'review', 'completed'],
        default: 'planning'
    },
    expectedCompletionDate: Date,
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true,
        validate: {
            validator: function(value) {
                // Only validate isActive for website update products
                if (!this.productId) return true;
                return true; // The actual validation will happen in the controller
            },
            message: 'Invalid update plan status'
        }
    },
    updatesUsed: {
        type: Number,
        default: 0
    },
    // New fields for yearly renewable plans
    monthlyRenewalHistory: [{
        renewalDate: {
            type: Date,
            required: true
        },
        renewalCost: {
            type: Number,
            required: true
        },
        paymentStatus: {
            type: String,
            enum: ['paid', 'pending', 'expired'],
            default: 'paid'
        },
        renewalPeriodStart: {
            type: Date,
            required: true
        },
        renewalPeriodEnd: {
            type: Date,
            required: true
        },
        updatesUsedInPeriod: {
            type: Number,
            default: 0
        }
    }],
    totalYearlyDaysRemaining: {
        type: Number,
        validate: {
            validator: function(value) {
                if (value !== null && value !== undefined) {
                    return value >= 0 && value <= 365;
                }
                return true;
            },
            message: 'Yearly days remaining must be between 0 and 365'
        }
    },
    currentMonthExpiryDate: {
        type: Date
    },
    autoRenewalStatus: {
        type: String,
        enum: ['active', 'paused', 'expired'],
        default: 'active'
    },
    currentMonthUpdatesUsed: {
        type: Number,
        default: 0
    },
    // New fields for monthly limited plans
    currentMonthUpdatesLimit: {
        type: Number,
        default: null  // Will be set from product.monthlyUpdateLimit
    },
    currentMonthUpdatesRemaining: {
        type: Number,
        default: null  // Calculated as: limit - used
    },
    monthlyLimitResetDate: {
        type: Date,
        default: null  // Date when monthly counter resets
    },
    assignedDeveloper: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Developer',
        default: null
    },
    assignedAt: {
        type: Date,
        default: null
    },
    isPartialPayment: {
        type: Boolean,
        default: false
    },
    currentInstallment: {
        type: Number,
        default: 1,
        min: 1,
        max: 3
    },
    totalAmount: {
        type: Number
    },
    paidAmount: {
        type: Number,
        default: 0
    },
    remainingAmount: {
        type: Number,
        default: 0
    },
    installments: [installmentSchema],
    paymentComplete: {
        type: Boolean,
        default: false
    },
    orderVisibility: {
        type: String,
        enum: ['visible', 'approved', 'pending-approval', 'payment-rejected', 'hidden'],
        default: 'visible'
    },
    rejectionReason: {
        type: String,
        default: null
    },
    orderItems: {
        type: [{
            id: String,
            name: String,
            type: { type: String, enum: ['main', 'feature'] },
            quantity: Number,
            originalPrice: Number,
            finalPrice: Number,
            additionalQuantity: { type: Number, default: 0 }
        }],
        default: []
    },
    isCombinedOrder: {
        type: Boolean,
        default: false
    },
    // Add project link field
    projectLink: {
        type: String,
        default: ''
    },
    // Plan closure fields
    planStatus: {
        type: String,
        enum: ['active', 'closed'],
        default: 'active'
    },
    closureReason: {
        type: String,
        default: null
    },
    closedAt: {
        type: Date,
        default: null
    },
    closedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        default: null
    }
}, {
    timestamps: true
});

orderSchema.pre('save', async function(next) {
    // Only run when order is first created (isNew) and doesn't already have checkpoints
    if (this.isNew && this.productId && (!this.checkpoints || this.checkpoints.length === 0)) {
      try {
        // Fetch the product to get checkpoints
        const product = await mongoose.model('product').findById(this.productId);
        
        if (product) {
          // Set isWebsiteProject based on product category
          const websiteCategories = ['standard_websites', 'dynamic_websites', 'cloud_software_development', 'app_development'];
          this.isWebsiteProject = websiteCategories.includes(product.category);
          
          // Copy checkpoints from product if they exist
          if (product.checkpoints && product.checkpoints.length > 0) {
            console.log('Copying checkpoints from product');
            this.checkpoints = product.checkpoints.map((cp, index) => ({
              checkpointId: index + 1,
              name: cp.name,
              percentage: cp.percentage,
              completed: false
            }));
            console.log('Order checkpoints after mapping:', JSON.stringify(this.checkpoints));
          }
        }
      } catch (error) {
        console.error('Error initializing checkpoints:', error);
      }
    }
    next();
  });

// Middleware to update lastUpdated
orderSchema.pre('save', function(next) {
    this.lastUpdated = new Date();
    next();
});

// Middleware to update projectProgress based on checkpoints
orderSchema.pre('save', function(next) {
    if (this.isWebsiteProject && this.checkpoints.length > 0) {
        const completedCheckpoints = this.checkpoints.filter(cp => cp.completed);
        const totalPercentage = completedCheckpoints.reduce((sum, cp) => sum + cp.percentage, 0);
        this.projectProgress = Math.min(totalPercentage, 100);
    }
    next();
});

orderSchema.methods.payInstallment = function(installmentNumber, amount) {
    // Find the installment
    const installment = this.installments.find(i => i.installmentNumber === installmentNumber);
    
    if (installment && !installment.paid) {
        installment.paid = true;
        installment.paidDate = new Date();
        
        // Update payment tracking
        this.paidAmount += amount;
        this.remainingAmount = this.totalAmount - this.paidAmount;
        
        // If all installments are paid, mark as complete
        const allPaid = this.installments.every(i => i.paid);
        if (allPaid) {
            this.paymentComplete = true;
        } else {
            // Move to next installment
            const nextInstallment = this.installments.find(i => !i.paid);
            if (nextInstallment) {
                this.currentInstallment = nextInstallment.installmentNumber;
            }
        }
        
        return true;
    }
    
    return false;
};

const orderModel = mongoose.model('order', orderSchema);
module.exports = orderModel;
