const orderModel = require("../../models/orderProductModel");
const transactionModel = require("../../models/transactionModel");
const userModel = require("../../models/userModel");

// Controller to get first purchase list for a partner
const getFirstPurchaseList = async (req, res) => {
  try {
    const partnerId = req.userId; // Assuming userId is set in auth middleware
    console.log("Partner ID:", partnerId);

    // Find customers referred by this partner
    const referredCustomers = await userModel.find({ referredBy: partnerId }).select("_id name");
    console.log("Referred Customers:", referredCustomers);

    const referredCustomerIds = referredCustomers.map(c => c._id);
    console.log("Referred Customer IDs:", referredCustomerIds);

    // Find orders of referred customers that are approved
    const orders = await orderModel.find({
      userId: { $in: referredCustomerIds },
      orderVisibility: { $in: ["approved", "visible"] }
    })
    .populate("userId", "name")
    .populate("productId", "serviceName")
    .lean();
    console.log("Orders found:", orders);

    // For each order, find related transactions that are completed (approved payments)
    const firstPurchaseEntries = [];

    for (const order of orders) {
      // Find transactions for this order that are completed
      const transactions = await transactionModel.find({
        orderId: order._id,
        status: "completed"
      }).lean();
      console.log(`Transactions for order ${order._id}:`, transactions);

      // If no transactions, skip
      if (!transactions || transactions.length === 0) continue;

      // For each transaction, create an entry
      for (const txn of transactions) {
        // Determine purchase type
        let purchaseType = "Full Payment";
        if (order.isPartialPayment && txn.installmentNumber) {
          purchaseType = `${txn.installmentNumber}th Installment`;
          if (txn.installmentNumber === 1) purchaseType = "1st Installment";
          else if (txn.installmentNumber === 2) purchaseType = "2nd Installment";
          else if (txn.installmentNumber === 3) purchaseType = "3rd Installment";
        }

        // Calculate revenue amount as 10% of transaction amount
        const revenueAmount = txn.amount * 0.10;

        firstPurchaseEntries.push({
          customerName: order.userId.name,
          productName: order.productId.serviceName,
          purchaseType: purchaseType,
          amountPaid: txn.amount,
          revenueAmount: revenueAmount,
          date: txn.createdAt
        });
      }
    }

    // Sort entries by date descending
    firstPurchaseEntries.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      success: true,
      data: firstPurchaseEntries
    });
  } catch (error) {
    console.error("Error fetching first purchase list:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch first purchase list"
    });
  }
};

module.exports = {
  getFirstPurchaseList
};
