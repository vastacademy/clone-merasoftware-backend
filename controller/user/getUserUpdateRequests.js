const updateRequestModel = require("../../models/updateRequestModel");


async function getUserUpdateRequests(req, res) {
    try {
      const userId = req.userId;
      
      // Find all update requests by the user
      const updateRequests = await updateRequestModel.find({
        userId
      })
      .populate('updatePlanId', 'productId')
      .populate({
        path: 'updatePlanId',
        populate: {
          path: 'productId',
          select: 'serviceName'
        }
      })
      .sort({ createdAt: -1 });
      
      return res.status(200).json({
        message: "Update requests retrieved successfully",
        error: false,
        success: true,
        data: updateRequests
      });
    } catch (error) {
      console.error('Error fetching user update requests:', error);
      return res.status(400).json({
        message: error.message || error,
        error: true,
        success: false
      });
    }
  }

module.exports = getUserUpdateRequests  