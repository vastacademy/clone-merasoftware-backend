const userModel = require("../../models/userModel")

async function userDetailsController (req,res) {
    try {
        console.log("userId", req.userId);
         const user = await userModel.findById(req.userId).select('name email roles walletBalance userDetails bankAccounts'); 

        if (!user) {
            throw new Error("User not found");
        }

        res.status(200).json({
            data: {
                ...user._doc,
                role: req.userRole, 
                walletBalance: user.walletBalance, // Explicitly include wallet balance
                bankAccounts: user.bankAccounts,
                userDetails: {
                    ...user.userDetails,
                    isDetailsCompleted: user.userDetails?.isDetailsCompleted || false
                }
            },
            error : false,
            success: true,
            message: "User Details"
        })

        console.log("user", user);
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error : true,
            success : false
        })
    }
}

module.exports = userDetailsController