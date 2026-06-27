const updateRequestModel = require("../../models/updateRequestModel");
const developerPermission = require("../../helpers/developerPermission");

async function getAssignedUpdates(req, res) {
  try {
    const developerId = req.userId;


    // Check developer permission
    const hasPermission = await developerPermission(developerId);
    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to perform this action"
      });
    }
    
    // Find all update requests assigned to this developer
    const assignedUpdates = await updateRequestModel.find({
      assignedDeveloper: developerId
    })
    .populate('userId', 'name email')
    .populate({
      path: 'updatePlanId',
      populate: {
        path: 'productId',
        select: 'serviceName validityPeriod updateCount'
      }
    })
    .sort({ createdAt: -1 });
    
    return res.status(200).json({
      message: "Assigned updates retrieved successfully",
      error: false,
      success: true,
      data: assignedUpdates
    });
  } catch (error) {
    console.error('Error fetching assigned updates:', error);
    return res.status(400).json({
      message: error.message || error,
      error: true,
      success: false
    });
  }
}

module.exports = getAssignedUpdates