const crypto = require("crypto");
const userModel = require("../../models/userModel");
const { creditWalletInstant } = require("../../helpers/transactionService");

// Fixed demo amount — guests never choose a real amount, this is not a payment flow.
const DUMMY_CREDIT_AMOUNT = 5000;

// Guest-only fake wallet top-up. Reuses the same creditWalletInstant SSOT as the
// real admin-recharge path so wallet history isn't a separate/empty system for
// guests, but is clearly tagged paymentMethod: "demo" so it's never mistaken for
// real money in any ledger view.
const guestDummyWalletCreditController = async (req, res) => {
  try {
    const user = await userModel.findById(req.userId).select("isGuest");
    if (!user?.isGuest) {
      return res.status(403).json({
        message: "This action is only available to guest accounts",
        error: true,
        success: false,
      });
    }

    const transactionId = `GUEST-DEMO-${crypto.randomBytes(8).toString("hex")}`;

    const transaction = await creditWalletInstant({
      userId: req.userId,
      transactionId,
      amount: DUMMY_CREDIT_AMOUNT,
      paymentMethod: "demo",
      description: "Guest demo wallet credit (not real money)",
    });

    const updatedUser = await userModel.findById(req.userId).select("walletBalance");

    return res.status(200).json({
      message: "Demo wallet credited",
      data: {
        walletBalance: updatedUser.walletBalance,
        transactionId: transaction.transactionId,
      },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error crediting guest demo wallet:", error);
    return res.status(400).json({
      message: error.message || "Failed to credit demo wallet",
      error: true,
      success: false,
    });
  }
};

module.exports = guestDummyWalletCreditController;
