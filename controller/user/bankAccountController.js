const userModel = require("../../models/userModel");

async function addBankAccount(req, res) {
  try {
    const userId = req.userId;
    const {
      bankName,
      bankAccountNumber,
      bankIFSCCode,
      accountHolderName,
      upiId,
      qrCode,
      isPrimary,
    } = req.body;

    // Basic validation
    if (
      !bankName ||
      !bankAccountNumber ||
      !bankIFSCCode ||
      !accountHolderName
    ) {
      throw new Error(
        "Bank name, account number, IFSC code, and account holder name are required."
      );
    }

    // IFSC code validation
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(bankIFSCCode)) {
      throw new Error("Invalid IFSC code format.");
    }

    const user = await userModel.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }

    // Limit to 2 accounts
    if (user.bankAccounts.length >= 2) {
      throw new Error("You can add a maximum of 2 bank accounts.");
    }

    const newAccount = {
      bankName,
      bankAccountNumber,
      bankIFSCCode,
      accountHolderName,
      upiId: upiId || "",
      qrCode: qrCode || "",
      isPrimary: isPrimary || false,
    };

    // If new account is primary, set all others to non-primary
    if (newAccount.isPrimary) {
      user.bankAccounts.forEach((acc) => (acc.isPrimary = false));
    } else if (user.bankAccounts.length === 0) {
      // If it's the first account and not explicitly primary, make it primary by default
      newAccount.isPrimary = true;
    }

    user.bankAccounts.push(newAccount);
    await user.save();

    res.status(200).json({
      data: user.bankAccounts,
      success: true,
      error: false,
      message: "Bank account added successfully!",
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

async function updateBankAccount(req, res) {
  try {
    const userId = req.userId;
    const { accountId } = req.params; // Assuming you pass an ID for the account to update
    const {
      bankName,
      bankAccountNumber,
      bankIFSCCode,
      accountHolderName,
      upiId,
      qrCode,
      isPrimary,
    } = req.body;

    const user = await userModel.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }

    const accountIndex = user.bankAccounts.findIndex(
      (acc) => acc._id.toString() === accountId
    );
    if (accountIndex === -1) {
      throw new Error("Bank account not found.");
    }

    const accountToUpdate = user.bankAccounts[accountIndex];

    // Update fields if provided
    if (bankName !== undefined) accountToUpdate.bankName = bankName;
    if (bankAccountNumber !== undefined)
      accountToUpdate.bankAccountNumber = bankAccountNumber;
    if (bankIFSCCode !== undefined) {
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      if (!ifscRegex.test(bankIFSCCode)) {
        throw new Error("Invalid IFSC code format.");
      }
      accountToUpdate.bankIFSCCode = bankIFSCCode;
    }
    if (accountHolderName !== undefined)
      accountToUpdate.accountHolderName = accountHolderName;
    if (upiId !== undefined) accountToUpdate.upiId = upiId;
    if (qrCode !== undefined) accountToUpdate.qrCode = qrCode;

    // Handle primary status
    if (isPrimary !== undefined) {
      if (isPrimary) {
        user.bankAccounts.forEach((acc) => (acc.isPrimary = false)); // Set all others to false
      }
      accountToUpdate.isPrimary = isPrimary;
    }

    await user.save();

    res.status(200).json({
      data: user.bankAccounts,
      success: true,
      error: false,
      message: "Bank account updated successfully!",
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

async function deleteBankAccount(req, res) {
  try {
    const userId = req.userId;
    const { accountId } = req.params;

    const user = await userModel.findById(userId);
    if (!user) {
      throw new Error("User not found.");
    }

    const initialLength = user.bankAccounts.length;
    user.bankAccounts = user.bankAccounts.filter(
      (acc) => acc._id.toString() !== accountId
    );

    if (user.bankAccounts.length === initialLength) {
      throw new Error("Bank account not found.");
    }

    // If the deleted account was primary and there are other accounts, make the first one primary
    if (
      initialLength > 0 &&
      user.bankAccounts.length > 0 &&
      !user.bankAccounts.some((acc) => acc.isPrimary)
    ) {
      user.bankAccounts[0].isPrimary = true;
    }

    await user.save();

    res.status(200).json({
      data: user.bankAccounts,
      success: true,
      error: false,
      message: "Bank account deleted successfully!",
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

async function getBankAccounts(req, res) {
  try {
    const userId = req.userId;
    const user = await userModel.findById(userId).select("bankAccounts");

    if (!user) {
      throw new Error("User not found.");
    }

    res.status(200).json({
      data: user.bankAccounts,
      success: true,
      error: false,
      message: "Bank accounts fetched successfully!",
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

module.exports = {
  addBankAccount,
  updateBankAccount,
  deleteBankAccount,
  getBankAccounts,
};
