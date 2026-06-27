const cron = require('node-cron');
const updateRequestModel = require('../models/updateRequestModel');
const GoogleDriveService = require('./googleDriveService');
const path = require('path');

// Path to the Google Drive credentials file
let KEY_FILE_PATH;

// Check if running in production (Render)
if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  // Use the path from environment variable
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  // Use local development path
  KEY_FILE_PATH = path.join(__dirname, '../config/google-drive-credentials.json');
}
const FOLDER_NAME = 'ClientUpdateFiles';

class FileCleanupScheduler {
  constructor() {
    this.driveService = new GoogleDriveService(KEY_FILE_PATH, FOLDER_NAME);
  }

  // Schedule daily file cleanup
  scheduleCleanup() {
    // Run at midnight every day
    cron.schedule('0 0 * * *', async () => {
      console.log('Running scheduled file cleanup...');
      await this.cleanupExpiredFiles();
    });
  }

  // Clean up expired files
  async cleanupExpiredFiles() {
    try {
      const now = new Date();
      
      // Find all update requests with files that have expired
      const requests = await updateRequestModel.find({
        'files.expirationDate': { $lt: now }
      });
      
      for (const request of requests) {
        const expiredFiles = request.files.filter(file => 
          file.expirationDate && file.expirationDate < now && file.driveFileId
        );
        
        for (const file of expiredFiles) {
          // Delete from Google Drive
          try {
            await this.driveService.deleteFile(file.driveFileId);
            console.log(`Deleted expired file from Google Drive: ${file.originalName}`);
          } catch (error) {
            console.error(`Error deleting file ${file.originalName}:`, error);
          }
        }
        
        // Update the request to remove expired files
        const remainingFiles = request.files.filter(file => 
          !file.expirationDate || file.expirationDate >= now
        );
        
        await updateRequestModel.updateOne(
          { _id: request._id },
          { $set: { files: remainingFiles } }
        );
      }
      
      console.log('File cleanup completed');
    } catch (error) {
      console.error('Error in file cleanup:', error);
    }
  }
}

module.exports = new FileCleanupScheduler();