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
