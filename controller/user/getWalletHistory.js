const transactionModel = require('../../models/transactionModel');

const getWalletHistory = async (req, res) => {
  try {
    const transactions = await transactionModel
      .find({
        userId: req.userId,
        $or: [
          { type: { $in: ['deposit', 'refund'] } },
          { paymentMethod: 'wallet' },
        ],
      })
      .populate('productId', 'serviceName')
      // An order keeps its name in four places, and which one holds it depends on how the
      // order was created: a client project's name lives in projectSnapshot, a purchased
      // service's in servicePlanSnapshot, a catalogue purchase's on productId, and
      // orderItems carries what was bought whatever else is missing. This selected only
      // productId, so for any order whose catalogue product is retired or was never there
      // (custom projects, service plans) the name came back empty — and the wallet row fell
      // back to the transaction's `description`, a line written for the log, not the
      // customer: "Installment 1 (wallet) for order 6a952b7464002ecd93fc6743".
      //
      // Measured before changing this: of 10 spending rows, 10 had a name on their order
      // and 9 were printing the raw string instead. Nothing about the payment changes —
      // the name was already recorded, it just was not being asked for.
      .populate({
        path: 'orderId',
        select: 'productId projectSnapshot servicePlanSnapshot orderItems isServicePlan isWebsiteProject',
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
