const userModel = require("../../models/userModel");

async function completeUserDetailsController(req, res) {
    try {
        const userId = req.userId; // Assuming you get this from JWT middleware
        const { 
            age, 
            dob,
            kycDocuments, 
            address 
        } = req.body;

        // Validate required fields
        // if (!phone) {
        //     throw new Error("Phone number is required");
        // }

         // Phone validation
        // const phoneRegex = /^[6-9]\d{9}$/;
        // if (!phoneRegex.test(phone)) {
        //     throw new Error("Please provide a valid 10-digit phone number");
        // }

        if (!age) {
            throw new Error("Age is required");
        }

        // DOB validation
        if (!dob) {
        throw new Error("Date of birth is required");
        }

        const birthDate = new Date(dob);
        const today = new Date();

        let calculatedAge = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
            calculatedAge--;
        }

       
        // Age validation
        if (calculatedAge < 18 || calculatedAge > 100) {
            throw new Error("Age must be between 18 and 100");
        }

         // Age and DOB match check
        if (calculatedAge !== age) {
            throw new Error("Provided age does not match with calculated age from DOB");
        }

        // Find user
        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Check if details are already completed
        if (user.userDetails.isDetailsCompleted) {
            throw new Error("User details are already completed");
        }

        // Validate bank accounts if provided
        // if (bankAccounts && bankAccounts.length > 0) {
        //     // Check if only one account is marked as primary
        //     const primaryAccounts = bankAccounts.filter(acc => acc.isPrimary);
        //     if (primaryAccounts.length > 1) {
        //         throw new Error("Only one bank account can be marked as primary");
        //     }
            
        //     // If no primary account is specified, make the first one primary
        //     if (primaryAccounts.length === 0 && bankAccounts.length > 0) {
        //         bankAccounts[0].isPrimary = true;
        //     }

        //     // Validate bank account details
        //     for (let account of bankAccounts) {
        //         if (!account.bankName) {
        //             throw new Error("Bank name is required for all bank accounts");
        //         }
        //         if (!account.bankAccountNumber) {
        //             throw new Error("Bank account number is required for all bank accounts");
        //         }
        //         if (!account.bankIFSCCode) {
        //             throw new Error("Bank IFSC code is required for all bank accounts");
        //         }
        //         if (!account.accountHolderName) {
        //             throw new Error("Account holder name is required for all bank accounts");
        //         }
                
        //         // IFSC code validation
        //         const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
        //         if (!ifscRegex.test(account.bankIFSCCode)) {
        //             throw new Error("Invalid IFSC code format");
        //         }
        //     }
        // }

        // Validate address if provided
        if (address) {
            if (address.pinCode && !/^\d{6}$/.test(address.pinCode)) {
                throw new Error("PIN code must be 6 digits");
            }
        }

        // Prepare update object
        const updateData = {
            dob,
            age: calculatedAge,
            'userDetails.isDetailsCompleted': true,
            'userDetails.kycStatus': 'pending', // Set KYC status to pending on submission/resubmission
            'userDetails.kycRejectionReasons': [], // Clear previous rejection reasons
            'userDetails.kycApprovedAt': null, // Clear previous approval timestamp
            'userDetails.kycRejectedAt': null
        };

        // Add optional fields if provided
        // if (bankAccounts && bankAccounts.length > 0) {
        //     updateData['userDetails.bankAccounts'] = bankAccounts;
        // }
        
        if (kycDocuments) {
            updateData['userDetails.kycDocuments'] = kycDocuments;
        }
        
        if (address) {
            updateData['userDetails.address'] = address;
        }

        // Update user details
        const updatedUser = await userModel.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-password'); // Exclude password from response

        res.status(200).json({
            data: updatedUser,
            success: true,
            error: false,
            message: "User details completed successfully! KYC submitted for verification."
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

module.exports = completeUserDetailsController;