// How many files one upload request may carry, per kind of upload
// (see helpers/uploadType.js for what the kinds mean).
//
// This is a per-request technical cap — Drive upload time, request memory, timeout —
// NOT a business allowance. How MANY times a customer may upload is a separate
// question, answered by the service plan's own allowance, and for a project by
// nothing at all: project portal access during development is unlimited by design.
const MAX_SERVICE_FILES_PER_UPLOAD = 100;
// A project gets the same cap as a service. It used to borrow the legacy number by
// accident: the modal fell back to LEGACY_MAX_FILE_COUNT whenever no service plan was
// selected, so a project showed "Maximum 20 files" — a legacy plan's allowance, shown
// on something that has no plan at all.
const MAX_PROJECT_FILES_PER_UPLOAD = 100;
const MAX_LEGACY_UPDATE_FILES_PER_UPLOAD = 20;
const MAX_UPLOAD_FILE_SIZE_BYTES = 5 * 1024 * 1024;

module.exports = {
  MAX_SERVICE_FILES_PER_UPLOAD,
  MAX_PROJECT_FILES_PER_UPLOAD,
  MAX_LEGACY_UPDATE_FILES_PER_UPLOAD,
  MAX_UPLOAD_FILE_SIZE_BYTES,
};
