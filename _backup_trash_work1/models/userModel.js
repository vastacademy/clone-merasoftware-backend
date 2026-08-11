const mongoose = require("mongoose")

const referralSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    role: {
        type: String,
        required: true
    },
    referredDate: {
        type: Date,
        default: Date.now
    }
}, { _id: false })

const userSchema = new mongoose.Schema({
    name: String,
    email: {
        type: String,
        required : true,
        unique: true,
    },
    password: String,
    profilePic : String,
    phone: String,     // Added phone field
    dob: {                    // New field: Date of Birth
      type: Date
    },
    age: Number,      // Added age field
    roles: {
        type: [String],
        required: true,
        default: []
    },
    isOtpVerified: {
        type: Boolean,
        default: false
    },
    // Set true when a user is auto-created (e.g. lead convert) with a universal
    // password. Frontend uses it to prompt a first-login password reset.
    mustResetPassword: {
        type: Boolean,
        default: false
    },
    // Plaintext copy of the password, stored only so an admin can view a user's
    // password from the client workspace. Written alongside the bcrypt hash at
    // signup / convert / reset, and backfilled on successful login for
    // pre-existing users. Gated by config/accessControlConfig.STORE_PLAIN_PASSWORD;
    // never used for authentication (login always compares the hash).
    plainPassword: {
        type: String,
        default: undefined
    },
    // Login gate. When false, an admin has disabled this account and login is
    // blocked in userSignIn. Default true so all existing users stay active.
    isActive: {
        type: Boolean,
        default: true
    },
    walletBalance: {
        type: Number,
        default: 0    
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user'
    },
    referrals: [referralSchema],
     bankAccounts: [
    {
      bankName: String,
      bankAccountNumber: String,
      bankIFSCCode: String,
      accountHolderName: String,
      upiId: String,
      qrCode: String, // URL to uploaded QR code image
      isPrimary: {
        type: Boolean,
        default: false
      }
    }
  ],
  userDetails: {
  address: {
    streetAddress: String,
    city: String,
    state: String,
    pinCode: String,
    landmark: String
  },
  kycDocuments: {
    documentType: String, // e.g., 'aadhar', 'driving_license'
    documentFrontPhoto: String, // URL or base64
    documentBackPhoto: String, // URL or base64 (optional for DL)
    selfiePhoto: String
  },
  isDetailsCompleted: {
    type: Boolean,
    default: false
  },
  // --- NEW KYC FIELDS START ---
    kycStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'], // Define allowed statuses
      default: 'pending' // Default status when details are completed
    },
    kycRejectionReasons: {
      type: [String], // Array to store multiple rejection reasons
      default: []
    },
    kycApprovedAt: {
      type: Date // Timestamp when KYC was approved
    },
    kycRejectedAt: {
      type: Date // Timestamp when KYC was rejected
    },
    kycAdminNotes: {
      type: String 
    }
    // --- NEW KYC FIELDS END ---
}
},{
    timestamps: true
})

const userModel = mongoose.model("user",userSchema)

module.exports = userModel
