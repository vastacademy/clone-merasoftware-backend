const transactionModel = require('../../models/transactionModel');

const getWalletHistory = async (req, res) => {
  try {
    const transactions = await transactionModel
      .find({userId: req.userId})
      .populate('productId', 'serviceName')
      .populate({
        path: 'orderId',
        select: 'productId',
        populate: {
          path: 'productId',
          select: 'serviceName'
        }
      })
      .sort({date: -1, createdAt: -1})
      .lean();

    return res.status(200).json({
      success: true,
      error: false,
      data: transactions,
    });
  } catch (error) {
    console.error('Error fetching wallet history:', error);
    return res.status(500).json({
      success: false,
      error: true,
      message: 'Unable to fetch wallet history',
    });
  }
};

module.exports = getWalletHistory;
