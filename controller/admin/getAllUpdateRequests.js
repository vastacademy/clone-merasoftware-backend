const updateRequestModel = require("../../models/updateRequestModel");
const assignDeveloperPermission = require("../../helpers/permission");

async function getAllUpdateRequests(req, res) {
  try {
    const sessionUserId = req.userId;
   
    // Check if user has permission
    if (!assignDeveloperPermission(sessionUserId)) {
      throw new Error("Permission denied");
    }
   
    // Populate the full chain of references
    const updateRequests = await updateRequestModel.find()
      .select('_id userId updatePlanId status instructions developerMessages assignedDeveloper createdAt updatedAt completedAt files')
      .populate('userId', 'name email')
      .populate({
        path: 'updatePlanId',
        populate: {
          path: 'productId',
          select: 'serviceName validityPeriod updateCount'
        }
      })
      .populate('assignedDeveloper', 'name email department')
      .sort({ createdAt: -1 });
   
    // Transform the response to include file information properly
    const transformedRequests = updateRequests.map(request => {
      const plainRequest = request.toObject();
     
      // Transform files to include proper links
      if (plainRequest.files && plainRequest.files.length > 0) {
        plainRequest.files = plainRequest.files.map(file => {
          // Make sure all necessary links exist
          if (!file.downloadLink && file.driveFileId) {
            file.downloadLink = `https://drive.google.com/uc?export=download&id=${file.driveFileId}`;
          }
          
          if (!file.embedLink && file.driveFileId && file.type && file.type.startsWith('image/')) {
            file.embedLink = `https://drive.google.com/uc?export=view&id=${file.driveFileId}`;
          }
          
          return {
            filename: file.filename,
            originalName: file.originalName,
            type: file.type,
            size: file.size,
            driveFileId: file.driveFileId,
            driveLink: file.driveLink,
            downloadLink: file.downloadLink,
            embedLink: file.embedLink
          };
        });
      }
     
      return plainRequest;
    });
   
    // Log a sample request to debug
    if (transformedRequests.length > 0) {
      console.log("Sample update request:", {
        id: transformedRequests[0]._id,
        userId: transformedRequests[0].userId,
        filesCount: transformedRequests[0].files ? transformedRequests[0].files.length : 0,
        filesExample: transformedRequests[0].files && transformedRequests[0].files.length > 0 ?
          transformedRequests[0].files[0] : "No files available"
      });
    } else {
      console.log("No update requests found");
    }
   
    return res.status(200).json({
      message: "Update requests retrieved successfully",
      error: false,
      success: true,
      data: transformedRequests
    });
  } catch (error) {
    console.error('Error fetching all update requests:', error);
    return res.status(400).json({
      message: error.message || error,
      error: true,
      success: false
    });
  }
}

module.exports = getAllUpdateRequests;