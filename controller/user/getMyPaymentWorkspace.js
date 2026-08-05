const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const invoiceModel = require("../../models/invoiceModel");
const transactionModel = require("../../models/transactionModel");
const { applyOrderSummary } = require("../../helpers/orderSummary");

const getMyPaymentWorkspace = async (req, res) => {
  try {
    const customerObjectId = new mongoose.Types.ObjectId(req.userId);

    const customer = await userModel
      .findById(customerObjectId)
      .select("name email phone status walletBalance createdAt updatedAt")
      .lean();
    if (!customer) {
      return res.status(404).json({
        message: "Customer not found",
        error: true,
        success: false,
      });
    }

    const [orders, transactions, monthlyInvoices, projectInvoices] = await Promise.all([
      applyOrderSummary(orderModel.find({ userId: customerObjectId }).sort({ createdAt: -1 })),
      transactionModel
        .find({ userId: customerObjectId })
        .select("transactionId upiTransactionId amount status type sourceType paymentMethod invoiceId orderId date createdAt rejectionReason")
        .sort({ createdAt: -1 }),
      monthlyInvoiceModel
        .find({ userId: customerObjectId })
        .select("orderId invoiceNumber amount status invoiceDate dueDate paidDate paymentMethod transactionReference createdAt")
        .populate("orderId", "productId")
        .populate({ path: "orderId", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
      invoiceModel
        .find({ userId: customerObjectId })
        .select("orderId invoiceNumber invoiceType amount status invoiceDate dueDate paidDate installmentNumber lineItems paymentMethod transactionReference createdAt")
        .populate("orderId", "productId")
        .populate({ path: "orderId", populate: { path: "productId", select: "serviceName" } })
        .sort({ createdAt: -1 }),
    ]);

    const invoices = [...monthlyInvoices, ...projectInvoices].sort(
      (a, b) => new Date(b.invoiceDate) - new Date(a.invoiceDate)
    );

    return res.status(200).json({
      message: "Payment workspace data fetched successfully",
      success: true,
      error: false,
      data: {
        orders,
        transactions,
        invoices,
        summary: {
          totalOrders: orders.length,
          walletBalance: customer.walletBalance || 0,
          invoiceCount: invoices.length,
          transactionCount: transactions.length,
        },
      },
    });
  } catch (error) {
    console.error("Error fetching customer payment workspace:", error);
    return res.status(500).json({
      message: error.message || "Failed to fetch payment workspace",
      success: false,
      error: true,
    });
  }
};

module.exports = getMyPaymentWorkspace;
