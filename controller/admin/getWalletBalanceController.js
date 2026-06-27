const userModel = require("../../models/userModel")

const getWalletBalanceController = async (req, res) => {
    try {
        // req.userId comes from authToken middleware
        const user = await userModel.findById(req.userId);
        
        if (!user) {
            throw new Error("User not found");
        }

        res.status(200).json({
            message: "Wallet balance fetched successfully",
            data: {
                balance: user.walletBalance
            },
            success: true,
            error: false
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
};

module.exports = getWalletBalanceController