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
    },
    nodeId: {
        type: String
    },
    runId: {
        type: String
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    }
});

const projectRunSchema = new mongoose.Schema({
    runId: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'archived'],
        default: 'active'
    },
    startedAt: {
        type: Date,
        default: Date.now
    },
    archivedAt: Date,
    startedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    archivedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    showToClient: {
        type: Boolean,
        default: false
    }
}, { _id: false });

const projectNodeSchema = new mongoose.Schema({
    nodeId: {
        type: String,
        required: true
    },
    runId: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true,
        trim: true
    },
    cumulativeProgress: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    status: {
        type: String,
        enum: ['active', 'deleted', 'archived'],
        default: 'active'
    },
    visibleToClient: {
        type: Boolean,
        default: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    deletedAt: Date,
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    restoredAt: Date,
    restoredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    editedAt: Date,
    editedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    messageIds: {
        type: [String],
        default: []
    }
}, { _id: false });

const projectNodeEventSchema = new mongoose.Schema({
    eventType: {
        type: String,
        enum: ['node_created', 'node_edited', 'node_deleted', 'node_restored', 'node_visibility_changed', 'project_reset'],
        required: true
    },
    nodeId: String,
    runId: {
        type: String,
        required: true
    },
    actorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    previousProgress: {
        type: Number,
        min: 0,
        max: 100
    },
    nextProgress: {
        type: Number,
        min: 0,
        max: 100
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    occurredAt: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

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
    // New fields for project management. No schema default — the pre('save') hook
    // below only derives this from the product category when a caller genuinely
    // didn't set it (createOrder.js/adminCreateProjectOrder.js always set it directly).
    isWebsiteProject: {
        type: Boolean
    },
    // Canonical dynamic project timeline. All website-project orders (new and
    // pre-existing, migrated via backend/scripts/migratePreExistingOrdersToNodeSystem.js)
    // are on version 1. The 4 non-website legacy orders remain on version 0 by design —
    // the node system only supports isWebsiteProject orders.
    projectTimelineVersion: {
        type: Number,
        default: 0
    },
    projectTimelineInitialized: {
        type: Boolean,
        default: false
    },
    projectRuns: {
        type: [projectRunSchema],
        default: []
    },
    projectNodes: {
        type: [projectNodeSchema],
        default: []
    },
    projectNodeEvents: {
        type: [projectNodeEventSchema],
        default: []
    },
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
    },

    // ---------------------------------------------------------------------
    // Service Plan System (new, additive). Coexists with the legacy plan
    // fields above — legacy fields/logic are untouched. isServicePlan is the
    // switch every enforcement/read path checks to pick the new vs old path.
    // servicePlanSnapshot freezes the plan template's servicePlan config at
    // purchase time so a later admin edit to the plan never silently changes
    // what a customer already bought.
    // ---------------------------------------------------------------------
    isServicePlan: {
        type: Boolean,
        default: false
    },
    servicePlanSnapshot: {
        planType: String,
        limitScope: String,
        manualUnit: String,
        manualCount: Number,
        portalAccessCount: Number,
        filesLimit: Number,
        validityUnit: String,
        validityValue: Number,
        validityInDays: Number,
        billingCycle: String
    },
    servicePlanStartDate: {
        type: Date,
        default: null
    },
    servicePlanEndDate: {
        type: Date,
        default: null
    },
    serviceCurrentCycleNumber: {
        type: Number,
        default: 1
    },
    serviceCurrentCycleStart: {
        type: Date,
        default: null
    },
    serviceCurrentCycleEnd: {
        type: Date,
        default: null
    },
    serviceAccessUsedInCycle: {
        type: Number,
        default: 0
    },
    serviceAccessUsedTotal: {
        type: Number,
        default: 0
    },
    serviceCycleHistory: {
        type: [{
            cycleNumber: Number,
            cycleStart: Date,
            cycleEnd: Date,
            accessUsed: Number
        }],
        default: []
    },
    servicePlanStatus: {
        type: String,
        enum: ['active', 'paused', 'expired', 'cancelled'],
        default: 'active'
    }
}, {
    timestamps: true
});

orderSchema.pre('save', async function(next) {
    // Only run when order is first created (isNew) and isWebsiteProject hasn't been
    // set explicitly by the caller (createOrder.js/adminCreateProjectOrder.js both set
    // it directly) — this is a fallback for any other order-creation path.
    if (this.isNew && this.productId && this.isWebsiteProject === undefined) {
      try {
        const product = await mongoose.model('product').findById(this.productId);
        if (product) {
          const websiteCategories = ['standard_websites', 'dynamic_websites', 'cloud_software_development', 'app_development'];
          this.isWebsiteProject = websiteCategories.includes(product.category);
        }
      } catch (error) {
        console.error('Error setting isWebsiteProject:', error);
      }
    }
    next();
  });

// Middleware to update lastUpdated
orderSchema.pre('save', function(next) {
    this.lastUpdated = new Date();
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
