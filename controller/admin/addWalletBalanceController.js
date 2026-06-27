const userModel = require("../../models/userModel")
const uploadProductPermission = require("../../helpers/permission")

const addWalletBalanceController = async (req, res) => {
    try {
        const { userId, amount } = req.body;

        // Check if all required fields are provided
        if (!userId || !amount) {
            throw new Error("Please provide userId and amount");
        }

        // Amount should be positive number
        if (amount <= 0) {
            throw new Error("Amount should be greater than 0");
        }

        // Admin check using your existing permission helper
        const isAdmin = await uploadProductPermission(req.userId);
        if (!isAdmin) {
            throw new Error("Only admin can add wallet balance");
        }

        // Find user and update wallet
        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }

        // Add amount to wallet
        user.walletBalance += Number(amount);
        await user.save();

        res.status(200).json({
            message: "Wallet balance updated successfully",
            data: {
                userId: user._id,
                currentBalance: user.walletBalance
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

module.exports = addWalletBalanceController;