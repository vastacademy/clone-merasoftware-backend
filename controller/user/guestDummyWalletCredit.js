const crypto = require("crypto");
const userModel = require("../../models/userModel");
const { creditWalletInstant } = require("../../helpers/transactionService");
const { GUEST_DEMO_CREDIT_AMOUNT } = require("../../config/guestDemoConfig");

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

    const { transaction, newBalance } = await creditWalletInstant({
      userId: req.userId,
      transactionId,
      amount: GUEST_DEMO_CREDIT_AMOUNT,
      paymentMethod: "demo",
      description: "Guest demo wallet credit (not real money)",
    });

    return res.status(200).json({
      message: "Demo wallet credited",
      data: {
        walletBalance: newBalance,
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
