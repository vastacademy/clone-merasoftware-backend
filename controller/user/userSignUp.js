const userModel = require("../../models/userModel")
const bcrypt = require('bcryptjs');


async function userSignUpController (req,res) {
    try {
        const { email, password, name, role, referredBy } = req.body

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            throw new Error("Please provide valid email address");
        }

        if(!email){
            throw new Error("Please provide email")
        }
        if(!password){
            throw new Error("Please provide password")
        }
        if(!name){
            throw new Error("Please provide name")
        }
        if (!role) {
            throw new Error("Please provide role");
        }

        // Password validation
        if (password.length < 6) {
            throw new Error("Password must be at least 6 characters long");
        }

        const salt = bcrypt.genSaltSync(10);
        const hashPassword = await bcrypt.hashSync(password, salt);

        if(!hashPassword){
            throw new Error("Something is Wrong")
        }

        const normalizedEmail = email.trim().toLowerCase();

        // Check if user with email exists
        let existingUser = await userModel.findOne({ email: normalizedEmail });

        if (existingUser) {
            // Check if role already exists in roles array
            if (existingUser.roles.includes(role.toLowerCase())) {
                throw new Error("User with this role already exists.");
            } else {
                // Add new role to roles array
                existingUser.roles.push(role.toLowerCase());
                await existingUser.save();

                return res.status(200).json({
                    data: existingUser,
                    success: true,
                    error: false,
                    message: "Role added to existing user successfully!"
                });
            }
        }

        // If user does not exist, create new user with roles array
        const payload = {
            email: normalizedEmail,
            name,
            password: hashPassword,
            roles: [role.toLowerCase()],
            walletBalance: 0,
            referredBy: referredBy ? referredBy : null, // Store the referrer ID
            referrals: [] // Initialize an empty array for tracking referrals
        }

        const userData = new userModel(payload)
        const saveUser = await userData.save()

        // If a referrer is provided, update their document
         if (referredBy) {
            const referrer = await userModel.findById(referredBy);

            // Add new referral object with userId, role, and referredDate
            await userModel.findByIdAndUpdate(referredBy, {
                $addToSet: { referrals: { userId: saveUser._id, role: role.toLowerCase(), referredDate: new Date() } }
            });
        }

        res.status(201).json({
            data: saveUser,
            success: true,
            error: false,
            message: "User Created Successfully!"
        })

    } catch (err) {
        res.json({
            message: err.message || err,
            error: true,
            success: false,
        })  
    }
}


module.exports = userSignUpController