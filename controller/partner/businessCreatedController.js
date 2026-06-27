const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");
const transactionModel = require("../../models/transactionModel");

// Controller to get business created data for a partner
const getBusinessCreated = async (req, res) => {
  try {
    const partnerId = req.userId; // Assuming auth middleware sets req.userId

    // Find all transactions related to orders referred by this partner
    const transactions = await transactionModel.find({
      status: 'completed',
      referredBy: partnerId
    })
    .populate({
      path: 'userId',
      select: 'name referredBy'
    })
    .populate('orderId')
    .sort({ createdAt: -1 });

    // Filter transactions where user is referred by this partner
    const filteredTransactions = transactions.filter(txn => txn.userId && txn.userId.referredBy && txn.userId.referredBy.toString() === partnerId.toString());

    // Prepare result array
    const result = [];

    for (let i = 0; i < filteredTransactions.length; i++) {
      const txn = filteredTransactions[i];
      const user = txn.userId;
      const order = txn.orderId;

      if (!order) continue;

      // Find all approved/visible orders of this user sorted by creation date
      const userOrders = await orderModel.find({
        userId: user._id,
        orderVisibility: { $in: ['approved', 'visible'] }
      }).sort({ createdAt: 1 });

      // Determine if this transaction belongs to the first order
      let isFirstOrder = false;
      let paymentType = 'Repeat Purchase'; // Default to repeat purchase
      
      if (userOrders.length > 0 && userOrders[0]._id.equals(order._id)) {
        isFirstOrder = true;
        paymentType = 'First Purchase';
      }

      // Calculate revenue percentage and amount based on first/repeat order
      const revenuePercent = isFirstOrder ? 10 : 5;
      const revenueAmount = (txn.amount * revenuePercent) / 100;

      // Additional info for installment if needed
      let additionalInfo = '';
      if (txn.installmentNumber) {
        additionalInfo = ` (${txn.installmentNumber} Installment)`;
      } else if (order.isPartialPayment) {
        additionalInfo = ' (Partial Payment)';
      }

      result.push({
        serialNo: i + 1,
        customerName: user.name,
        revenueAmount: `${revenueAmount.toFixed(2)} (${revenuePercent}%)`,
        paidAmount: txn.amount,
        paymentType: paymentType,
        date: txn.createdAt
      });
    }

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("Error fetching business created data:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch business created data"
    });
  }
};

module.exports = {
  getBusinessCreated
};