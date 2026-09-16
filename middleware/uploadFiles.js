const multer = require("multer");
const path = require("path");
const { MAX_SERVICE_FILES_PER_UPLOAD, MAX_UPLOAD_FILE_SIZE_BYTES } = require("../config/uploadLimits");

// One multipart policy for every existing and external upload surface.
const uploadFiles = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
    files: MAX_SERVICE_FILES_PER_UPLOAD,
  },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;
    const extensions = new Set([".jpg", ".jpeg", ".txt", ".rtf", ".pdf", ".doc", ".docx"]);
    const mimeTypes = new Set([
      "image/jpeg",
      "text/plain",
      "application/rtf",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);

    if (!extensions.has(ext)) return cb(new Error("Only JPG, JPEG, TXT, RTF, PDF, DOC, DOCX files are allowed"));
    if (!mimeTypes.has(mimeType)) return cb(new Error("Invalid file type"));
    return cb(null, true);
  },
});

module.exports = uploadFiles;
