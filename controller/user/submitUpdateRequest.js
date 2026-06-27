const updateRequestModel = require("../../models/updateRequestModel");
const orderModel = require("../../models/orderProductModel");
const AdminSettings = require("../../models/adminSettingsModel");
const GoogleDriveService = require("../../helpers/googleDriveService");
const { sendUpdateRequestNotification, sendUserConfirmation } = require("../../helpers/emailService");
const { createUpdateRequestNotification } = require("../../helpers/notificationService");
const userModel = require('../../models/userModel');
const mongoose = require('mongoose');
const path = require('path');
const { ObjectId } = mongoose.Types;

// Path to the Google Drive credentials file
let KEY_FILE_PATH;

// Check if running in production (Render)
if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  // Use the path from environment variable
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  // Use local development path
  KEY_FILE_PATH = path.join(__dirname, '../../config/google-drive-credentials.json');
}
const FOLDER_NAME = 'ClientUpdateFiles';

// Error handling wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error('Error in async handler:', err);
    return res.status(500).json({
      message: err.message || 'Internal server error',
      error: true,
      success: false
    });
  });
};

const submitUpdateRequest = asyncHandler(async (req, res) => {
  console.log("Request body keys:", Object.keys(req.body));
  console.log("Files received:", req.files ? req.files.length : 'No files');
  
  const userId = req.userId;
  if (!userId) {
    return res.status(400).json({
      message: "User ID is required",
      error: true,
      success: false
    });
  }
  
  const { planId } = req.body;
  if (!planId) {
    return res.status(400).json({
      message: "Plan ID is required",
      error: true,
      success: false
    });
  }
  
  let instructions = [];
  
  // Parse instructions if provided
  if (req.body.instructions) {
    try {
      instructions = JSON.parse(req.body.instructions);
      console.log("Parsed instructions count:", instructions.length);
    } catch (e) {
      console.error('Error parsing instructions:', e);
      return res.status(400).json({
        message: "Invalid instructions format",
        error: true,
        success: false
      });
    }
  }
  
  // Validate the update plan exists and belongs to the user
  const updatePlan = await orderModel.findOne({
    _id: planId,
    userId,
    isActive: true
  }).populate('productId');

  if (!updatePlan) {
    return res.status(404).json({
      message: 'Update plan not found or not active',
      error: true,
      success: false
    });
  }

  // Check if plan is closed
  if (updatePlan.planStatus === 'closed') {
    return res.status(400).json({
      message: 'This plan has been closed and cannot accept updates',
      error: true,
      success: false
    });
  }
  
  // Check if the user has updates remaining
  if (updatePlan.updatesUsed >= updatePlan.productId.updateCount) {
    return res.status(400).json({
      message: 'No updates remaining in this plan',
      error: true,
      success: false
    });
  }

  // NEW: Check for monthly limited plans
  if (updatePlan.productId.isMonthlyLimitedPlan) {
    // Use one effective limit source so validation and counters stay in sync.
    const monthlyLimit =
      updatePlan.currentMonthUpdatesLimit ||
      updatePlan.productId.monthlyUpdateLimit ||
      1;
    const monthlyUsed = updatePlan.currentMonthUpdatesUsed || 0;

    if (monthlyUsed >= monthlyLimit) {
      const resetDate = updatePlan.monthlyLimitResetDate || updatePlan.currentMonthExpiryDate;
      return res.status(400).json({
        message: `You have used all ${monthlyLimit} updates for this month. Next reset on ${resetDate ? new Date(resetDate).toLocaleDateString('en-GB') : 'next renewal'}`,
        error: true,
        success: false
      });
    }

    // Check if current month has expired
    if (updatePlan.currentMonthExpiryDate && new Date() > new Date(updatePlan.currentMonthExpiryDate)) {
      return res.status(400).json({
        message: 'Your monthly period has expired. Please renew to continue.',
        error: true,
        success: false
      });
    }

    // Check if yearly duration is exhausted
    if (updatePlan.totalYearlyDaysRemaining !== undefined && updatePlan.totalYearlyDaysRemaining <= 0) {
      return res.status(400).json({
        message: 'Your yearly plan has ended. Please purchase a new plan.',
        error: true,
        success: false
      });
    }
  }

  // Check if the plan is still valid (for regular plans)
  if (!updatePlan.productId.isMonthlyRenewablePlan && !updatePlan.productId.isMonthlyLimitedPlan) {
    const validityInDays = updatePlan.productId.validityPeriod;
    const startDate = new Date(updatePlan.createdAt);
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + validityInDays);

    if (new Date() > endDate) {
      return res.status(400).json({
        message: 'Update plan has expired',
        error: true,
        success: false
      });
    }
  }
  
  // Initialize Google Drive service
  const driveService = new GoogleDriveService(KEY_FILE_PATH, FOLDER_NAME);
  
  // Get file expiration days from admin settings
  const adminSettings = await AdminSettings.getSettings();
  const fileExpirationDays = adminSettings.fileExpirationDays;
  
  // Create Google Drive folder for this request
  const folderId = await driveService.createFolder();
  
  // Process uploaded files and upload to Google Drive
  const fileObjects = [];
  if (req.files && req.files.length > 0) {
    console.log("***** FILE UPLOAD DEBUGGING *****");
    console.log("Files received count:", req.files.length);

    // Create Google Drive folder for this request
  console.log("Creating Google Drive folder for the request");
  const folderId = await driveService.createFolder();
  console.log("Folder created with ID:", folderId);


    for (const file of req.files) {
      try {
        // Set expiration date for the file
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + fileExpirationDays);
        
        // Create a Buffer from the file
        const fileBuffer = Buffer.from(file.buffer);
        
        // Clean filename and upload to Google Drive
        const safeFilename = file.originalname.replace(/\s+/g, '_');
        
        // Upload file to Google Drive
        console.log(`Uploading file "${safeFilename}" to Google Drive`);
        const uploadedFile = await driveService.uploadFile(
          safeFilename,
          fileBuffer,
          file.mimetype,
          folderId
        );

        // Generate direct download link and embedable link for images
      const downloadLink = driveService.getDownloadLink(uploadedFile.id);
      let embedLink = null;
  
       // Handle different file types
      if (file.mimetype.startsWith('image/')) {
        // For images
        embedLink = driveService.getEmbedableImageLink(uploadedFile.id);
      } else if (file.mimetype === 'application/pdf') {
        // For PDFs
        embedLink = driveService.getEmbedableDocumentLink(uploadedFile.id);
      } else if (file.mimetype === 'application/msword' || 
                file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // For Word documents
        embedLink = driveService.getEmbedableDocumentLink(uploadedFile.id);
      }
        
       // Add file info to the array - make sure each property is the right type
       fileObjects.push({
        filename: safeFilename,
        originalName: file.originalname,
        type: file.mimetype,
        size: file.size,
        driveFileId: uploadedFile.id,
        driveLink: uploadedFile.link,
        downloadLink: downloadLink,
        embedLink: embedLink,
        expirationDate: expirationDate
      });
        
      console.log(`Uploaded file: ${file.originalname} to Google Drive with ID: ${uploadedFile.id}`);
      } catch (error) {
        console.error('Error processing file:', error);
        console.error('File type:', file.mimetype, 'File name:', file.originalname);
       
      }
    }
  }
  
  // Create update request document
  try {
    console.log("***** DATABASE SAVE DEBUGGING *****");
    console.log("Files object structure:", JSON.stringify(fileObjects));

    // Create the update request
    const updateRequest = new updateRequestModel({
      userId: new ObjectId(userId),
      updatePlanId: new ObjectId(planId),
      instructions: instructions.map(msg => ({
        text: msg.text,
        timestamp: new Date(msg.timestamp || Date.now())
      })),
      files: fileObjects,
      status: 'pending'
    });
    
    // Save the request
    await updateRequest.save();
    
    // Update the plan's usedUpdates count
    // For yearly renewable plans and monthly limited plans, also increment currentMonthUpdatesUsed
    const updateFields = { updatesUsed: 1 };
    if (updatePlan.productId?.isMonthlyRenewablePlan || updatePlan.productId?.isMonthlyLimitedPlan) {
      updateFields.currentMonthUpdatesUsed = 1;
    }

    // For monthly limited plans, also update the remaining counter
    const updateQuery = { $inc: updateFields };
    if (updatePlan.productId?.isMonthlyLimitedPlan) {
      const effectiveMonthlyLimit =
        updatePlan.currentMonthUpdatesLimit ||
        updatePlan.productId.monthlyUpdateLimit ||
        1;
      const newRemaining = effectiveMonthlyLimit - (updatePlan.currentMonthUpdatesUsed + 1);
      updateQuery.$set = { currentMonthUpdatesRemaining: newRemaining };
    }

    await orderModel.updateOne(
      { _id: new ObjectId(planId) },
      updateQuery
    );

    // Populate the update request for email notifications
    const populatedRequest = await updateRequestModel.findById(updateRequest._id)
      .populate('userId', 'name email')
      .populate({
        path: 'updatePlanId',
        populate: {
          path: 'productId',
          select: 'serviceName validityPeriod updateCount'
        }
      });
    
    // Send email notifications
    console.log("Sending email notifications...");
    try {
      // Admin emails
      const adminEmails = ['vacomputers.com@gmail.com', 'syncvap@gmail.com'];

      await sendUpdateRequestNotification(populatedRequest, adminEmails);
      console.log(`Admin notification emails sent to ${adminEmails.length} admins`);
      
      // Send confirmation to user
      await sendUserConfirmation(populatedRequest);
      console.log("User confirmation email sent");
      
      // Create in-app notifications for admins
      await createUpdateRequestNotification(populatedRequest);
      console.log("Admin in-app notifications created");
    } catch (emailError) {
      console.error("Error with notification process:", emailError);
      // Continue execution even if notification fails
    }
    
    return res.status(200).json({
      message: "Update request submitted successfully",
      error: false,
      success: true,
      data: {
        requestId: updateRequest._id,
        updatesRemaining: updatePlan.productId.updateCount - (updatePlan.updatesUsed + 1)
      }
    });
  } catch (error) {
    console.error('Database error:', error);
    console.error('Error details:', error.errors ? JSON.stringify(error.errors) : 'No detailed errors');
    return res.status(500).json({
      message: error.message || 'Failed to save update request',
      error: true,
      success: false
    });
  }
});

module.exports = submitUpdateRequest;
