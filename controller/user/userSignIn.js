const bcrypt = require('bcryptjs');
const userModel = require("../../models/userModel");
const jwt = require('jsonwebtoken');

async function userSignInController (req,res) {
    try {
        const { email, password, role } = req.body

        if(!email){
            throw new Error("Please provide email")
        }
        if(!password){
            throw new Error("Please provide password")
        }
        if(!role){
            throw new Error("Please provide role")
        }

        const user = await userModel.findOne({email}).select('email password name roles walletBalance userDetails bankAccounts');

        if(!user){
            throw new Error("User not found")
        }

        if(!user.roles.includes(role.toLowerCase())){
            throw new Error("User does not have the requested role")
        }

        const checkPassword = await bcrypt.compare(password,user.password)
        
        if(checkPassword) {
            const tokenData = {
                _id: user._id,
                email: user.email,
                role: role.toLowerCase()
            };

            const token = await jwt.sign(tokenData, process.env.TOKEN_SECRET_KEY, { expiresIn: '365d' });
            const tokenOption = {
                httpOnly: true,
                secure: true,
                sameSite: 'None',
                path: '/',
                maxAge: 365 * 24 * 60 * 60 * 1000
            };

            if (process.env.COOKIE_DOMAIN) {
                tokenOption.domain = process.env.COOKIE_DOMAIN;
            }
            
            res.cookie("token", token, tokenOption).status(200).json({
                message: "Login Successfully",
                data: {
                    token,
                    user: {
                        ...user._doc,
                        password: undefined,
                        role: role.toLowerCase(),
                        bankAccounts: user.bankAccounts
                    },
                    walletBalance: user.walletBalance,
                    isDetailsCompleted: user.userDetails?.isDetailsCompleted || false,
                },
                success: true,
                error: false,
                requireOtp: false
            });
        } else {
            throw new Error("Please check password");
        }
    } catch (err) {
        res.json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

module.exports = userSignInController;
