const path = require("path");
const archiver = require("archiver");
const updateRequestModel = require("../../models/updateRequestModel");
const GoogleDriveService = require("../../helpers/googleDriveService");

// Download every file of ONE upload attempt as a single zip.
//
// Serves the customer (their own upload) and the admin (any customer's) from this one
// route, so both sides get identical bytes under identical rules.
//
// Rebuilt rather than copied from the old app's downloadAllFiles.js, which had three
// problems this deliberately does not repeat:
//   1. its route carried no authToken at all — any id fetched anyone's files
//   2. it gated on assignDeveloperPermission, a developer system that does not exist here
//      (and which locked the customer out of their own upload)
//   3. it built its own Drive client instead of using GoogleDriveService
//
// Files are streamed straight from Drive into the archive, so nothing is written to disk
// (the old version staged every file in a temp directory and then cleaned it up).

let KEY_FILE_PATH;
if (process.env.NODE_ENV === "production" && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  KEY_FILE_PATH = path.join(__dirname, "../../config/google-drive-credentials.json");
}

const FOLDER_NAME = "ClientUpdateFiles";

// Keep zip entry names unique and filesystem-safe; Drive allows names this does not.
const safeEntryName = (name, index) => {
  const base = String(name || `file-${index + 1}`).replace(/[\\/:*?"<>|]/g, "_");
  return base.trim() || `file-${index + 1}`;
};

const downloadUploadRequestZip = async (req, res) => {
  try {
    const { requestId } = req.params;
    const isAdmin = req.userRole === "admin";

    const request = await updateRequestModel.findById(requestId).select("userId files").lean();
    if (!request) {
      return res.status(404).json({
        message: "Upload not found",
        error: true,
        success: false,
      });
    }

    // Same rule as invoice documents: admin reads anything, everyone else only their own.
    if (!isAdmin && String(request.userId) !== String(req.userId)) {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const now = new Date();
    // Expired files are deleted from Drive by fileCleanupScheduler.js, so they are skipped
    // rather than attempted — otherwise the whole zip would fail on one missing file.
    const files = (request.files || []).filter(
      (file) => file.driveFileId && !(file.expirationDate && new Date(file.expirationDate) < now)
    );

    if (files.length === 0) {
      return res.status(404).json({
        message: "No downloadable files in this upload",
        error: true,
        success: false,
      });
    }

    const driveService = new GoogleDriveService(KEY_FILE_PATH, FOLDER_NAME);

    // Pull every stream up front. Doing this before a single byte of response is written
    // means a Drive failure can still be reported as JSON; once the archive starts piping,
    // the status code is already sent and an error can only abort the download.
    const entries = [];
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      try {
        const stream = await driveService.getFileStream(file.driveFileId);
        entries.push({ stream, name: safeEntryName(file.originalName || file.filename, index) });
      } catch (error) {
        // One unreadable file must not lose the rest of the upload.
        console.error(`Skipping unreadable Drive file ${file.driveFileId}:`, error.message);
      }
    }

    if (entries.length === 0) {
      return res.status(502).json({
        message: "Files could not be read from storage",
        error: true,
        success: false,
      });
    }

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (error) => {
      console.error("Archive error:", error);
      // Headers are already out by this point; destroying the socket is the only honest
      // signal left that the zip is incomplete.
      res.destroy(error);
    });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=uploaded-data-${requestId}.zip`);
    archive.pipe(res);

    entries.forEach((entry) => archive.append(entry.stream, { name: entry.name }));
    await archive.finalize();
  } catch (error) {
    console.error("Error building upload zip:", error);
    if (res.headersSent) {
      return res.destroy(error);
    }
    return res.status(500).json({
      message: error.message || "Failed to download files",
      error: true,
      success: false,
    });
  }
};

module.exports = downloadUploadRequestZip;
