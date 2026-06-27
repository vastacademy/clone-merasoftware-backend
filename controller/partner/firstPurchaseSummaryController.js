const orderModel = require("../../models/orderProductModel");
const userModel = require("../../models/userModel");

// Controller to get first purchase summary for each customer of a partner
const getFirstPurchaseSummary = async (req, res) => {
  try {
    const partnerId = req.userId; // Assuming userId is set in auth middleware

    // Find customers referred by this partner
    const referredCustomers = await userModel.find({ referredBy: partnerId }).select("_id name");

    const referredCustomerIds = referredCustomers.map(c => c._id);

    // For each customer, find their first approved order sorted by creation date
    const firstPurchases = await Promise.all(
      referredCustomerIds.map(async (customerId) => {
        const firstOrder = await orderModel.findOne({
          userId: customerId,
          orderVisibility: { $in: ["approved", "visible"] }
        })
        .populate('productId', 'serviceName')
        .sort({ createdAt: 1 }) // earliest order
        .lean();

        if (!firstOrder) {
          return {
            customerId,
            productName: "Pending",
            finalPrice: "Pending",
            paymentType: "Pending"
          };
        }

        // Determine payment type
        const paymentType = firstOrder.isPartialPayment ? "Partial Payment" : "Full Payment";

        return {
          customerId,
          productName: firstOrder.productId?.serviceName || "Unknown",
          finalPrice: firstOrder.totalAmount || firstOrder.price || "N/A",
          paymentType
        };
      })
    );

    res.json({
      success: true,
      data: firstPurchases
    });
  } catch (error) {
    console.error("Error fetching first purchase summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch first purchase summary"
    });
  }
};

module.exports = {
  getFirstPurchaseSummary
};
