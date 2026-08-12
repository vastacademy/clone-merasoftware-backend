const path = require("path");
const userModel = require("../../models/userModel");
const GoogleDriveService = require("../../helpers/googleDriveService");

// Path to the Google Drive credentials file (same resolution as uploadProposal.js
// / submitUpdateRequest.js — one file-handling pattern across the codebase).
let KEY_FILE_PATH;
if (process.env.NODE_ENV === "production" && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  KEY_FILE_PATH = path.join(__dirname, "../../config/google-drive-credentials.json");
}
const FOLDER_NAME = "ClientDocuments";

const ALLOWED_SOURCES = ["agreement", "general"];

// Admin uploads a document (agreement etc.) to a client's own documents[] array.
// Works whether or not the client has a running project — the document lives on
// the client (userModel), never on an order/node. Optional nodeId/orderId are
// accepted so a node-update upload can back-link to the node it arrived with.
const uploadClientDocument = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { customerId } = req.params;

    const client = await userModel.findOne({ _id: customerId, roles: "customer" });
    if (!client) {
      return res.status(404).json({
        message: "Client not found",
        error: true,
        success: false,
      });
    }

    const file = (req.files && req.files[0]) || null;
    if (!file) {
      return res.status(400).json({
        message: "Please attach a document file (PDF or DOC)",
        error: true,
        success: false,
      });
    }

    const source = ALLOWED_SOURCES.includes(req.body?.source) ? req.body.source : "general";
    const orderId = req.body?.orderId || null;
    const nodeId = req.body?.nodeId || null;

    // Upload to Google Drive (reuse the existing shared service).
    const driveService = new GoogleDriveService(KEY_FILE_PATH, FOLDER_NAME);
    const folderId = await driveService.createFolder();

    const fileBuffer = Buffer.from(file.buffer);
    const safeFilename = file.originalname.replace(/\s+/g, "_");

    const uploadedFile = await driveService.uploadFile(
      safeFilename,
      fileBuffer,
      file.mimetype,
      folderId
    );

    const downloadLink = driveService.getDownloadLink(uploadedFile.id);

    client.documents.push({
      name: safeFilename,
      driveFileId: uploadedFile.id,
      downloadLink,
      type: file.mimetype,
      size: file.size,
      source,
      orderId,
      nodeId,
      uploadedAt: new Date(),
      uploadedBy: req.userId,
    });

    await client.save();

    const saved = client.documents[client.documents.length - 1];

    return res.json({
      message: "Document uploaded successfully",
      data: { document: saved },
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error uploading client document:", error);
    return res.status(400).json({
      message: error.message || "Failed to upload document",
      error: true,
      success: false,
    });
  }
};

module.exports = uploadClientDocument;
