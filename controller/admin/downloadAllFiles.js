const { google } = require('googleapis');
const path = require('path');
const archiver = require('archiver'); // You'll need to install this package
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs
const updateRequestModel = require("../../models/updateRequestModel");
const assignDeveloperPermission = require("../../helpers/permission");

// Path to the Google Drive credentials file - same as in your submitUpdateRequest.js
let KEY_FILE_PATH;
if (process.env.NODE_ENV === 'production' && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  KEY_FILE_PATH = path.join(__dirname, '../../config/google-drive-credentials.json');
}

async function downloadAllFiles(req, res) {
  try {
    const sessionUserId = req.userId;
    const requestId = req.params.requestId;
    
    // Check if user has permission
    if (!assignDeveloperPermission(sessionUserId)) {
      throw new Error("Permission denied");
    }

    // Find the update request
    const updateRequest = await updateRequestModel.findById(requestId);
    if (!updateRequest) {
      return res.status(404).json({
        message: "Update request not found",
        error: true,
        success: false
      });
    }

    // Check if there are files to download
    if (!updateRequest.files || updateRequest.files.length === 0) {
      return res.status(404).json({
        message: "No files found in this update request",
        error: true,
        success: false
      });
    }

    // Create a Google Drive client
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE_PATH,
      scopes: ['https://www.googleapis.com/auth/drive']
    });
    const driveClient = google.drive({ version: 'v3', auth });

    // Create a unique temp directory for this download
    const tempDirPath = path.join(os.tmpdir(), `update-files-${uuidv4()}`);
    fs.mkdirSync(tempDirPath, { recursive: true });

    // Create a zip file
    const zipFilePath = path.join(tempDirPath, `update-request-${requestId}.zip`);
    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Set up archive events
    output.on('close', () => {
      console.log(`Archive created: ${archive.pointer()} total bytes`);
      
      // Send the file
      res.download(zipFilePath, `update-request-${requestId}.zip`, (err) => {
        if (err) {
          console.error('Error sending zip file:', err);
        }
        
        // Clean up temp files after sending (regardless of error)
        try {
          fs.unlinkSync(zipFilePath);
          fs.rmdirSync(tempDirPath, { recursive: true });
        } catch (cleanupErr) {
          console.error('Error cleaning up temp files:', cleanupErr);
        }
      });
    });

    archive.on('error', (err) => {
      console.error('Archive error:', err);
      return res.status(500).json({
        message: "Failed to create zip archive",
        error: true,
        success: false
      });
    });

    // Pipe archive data to the file
    archive.pipe(output);

    // Download each file and add to the archive
    for (const file of updateRequest.files) {
      try {
        // Skip if no driveFileId
        if (!file.driveFileId) {
          console.warn(`Missing driveFileId for file ${file.filename}`);
          continue;
        }

        console.log(`Downloading file with ID: ${file.driveFileId}`);
        
        // Create a promise to download the file
        const fileData = await driveClient.files.get({
          fileId: file.driveFileId,
          alt: 'media'
        }, { responseType: 'stream' });
        
        // Create a temporary file path for this file
        const tempFilePath = path.join(tempDirPath, file.originalName || file.filename);
        
        // Save the stream to a temporary file
        await new Promise((resolve, reject) => {
          const dest = fs.createWriteStream(tempFilePath);
          fileData.data
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .pipe(dest);
        });
        
        // Add file to archive
        archive.file(tempFilePath, { name: file.originalName || file.filename });
        
        console.log(`Added ${file.originalName || file.filename} to archive`);
      } catch (fileError) {
        console.error(`Error processing file ${file.filename}:`, fileError);
        // Continue with other files instead of failing the whole request
      }
    }

    // Finalize the archive
    console.log('Finalizing archive...');
    await archive.finalize();
    
  } catch (error) {
    console.error('Error in downloadAllFiles:', error);
    return res.status(500).json({
      message: error.message || "Failed to download files",
      error: true,
      success: false
    });
  }
}

module.exports = downloadAllFiles;