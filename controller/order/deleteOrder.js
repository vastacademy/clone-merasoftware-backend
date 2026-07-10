const mongoose = require("mongoose");
const path = require("path");
const orderModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const transactionModel = require("../../models/transactionModel");
const partnerCommissionModel = require("../../models/partnerCommissionModel");
const userModel = require("../../models/userModel");
const GoogleDriveService = require("../../helpers/googleDriveService");

let KEY_FILE_PATH;
if (process.env.NODE_ENV === "production" && process.env.GOOGLE_DRIVE_CREDENTIALS_PATH) {
  KEY_FILE_PATH = process.env.GOOGLE_DRIVE_CREDENTIALS_PATH;
} else {
  KEY_FILE_PATH = path.join(__dirname, "../../config/google-drive-credentials.json");
}

const FOLDER_NAME = "ClientUpdateFiles";

const collectDriveFileIds = (requests) => {
  const fileIds = new Set();

  for (const request of requests) {
    for (const file of request?.files || []) {
      if (file?.driveFileId) {
        fileIds.add(String(file.driveFileId));
      }
    }
  }

  return [...fileIds];
};

const deleteOrderController = async (req, res) => {
  const session = await mongoose.startSession();
  let transactionStarted = false;

  try {
    const user = await userModel.findById(req.userId).select("roles");
    if (req.userRole !== "admin" || !user?.roles?.includes("admin")) {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { orderId } = req.params;
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({
        message: "Valid orderId is required",
        error: true,
        success: false,
      });
    }

    const orderObjectId = new mongoose.Types.ObjectId(orderId);
    const order = await orderModel.findById(orderObjectId).populate("productId", "serviceName");

    if (!order) {
      return res.status(404).json({
        message: "Order not found",
        error: true,
        success: false,
      });
    }

    const [relatedUpdateRequests, relatedInvoices, relatedTransactions, relatedCommissions] =
      await Promise.all([
        updateRequestModel.find({ updatePlanId: orderObjectId }),
        monthlyInvoiceModel.find({ orderId: orderObjectId }),
        transactionModel.find({ orderId: orderObjectId }),
        partnerCommissionModel.find({ orderId: orderObjectId }),
      ]);

    const driveFileIds = collectDriveFileIds(relatedUpdateRequests);
    const driveService = driveFileIds.length > 0
      ? new GoogleDriveService(KEY_FILE_PATH, FOLDER_NAME)
      : null;

    session.startTransaction();
    transactionStarted = true;

    try {
      for (const fileId of driveFileIds) {
        await driveService.deleteFile(fileId);
      }

      await Promise.all([
        updateRequestModel.deleteMany({ updatePlanId: orderObjectId }).session(session),
        monthlyInvoiceModel.deleteMany({ orderId: orderObjectId }).session(session),
        transactionModel.deleteMany({ orderId: orderObjectId }).session(session),
        partnerCommissionModel.deleteMany({ orderId: orderObjectId }).session(session),
        orderModel.deleteOne({ _id: orderObjectId }).session(session),
      ]);

      await session.commitTransaction();

      return res.status(200).json({
        message: "Project and all linked data deleted successfully",
        success: true,
        error: false,
        data: {
          orderId,
          serviceName: order.productId?.serviceName || "N/A",
          deletedCounts: {
            updateRequests: relatedUpdateRequests.length,
            invoices: relatedInvoices.length,
            transactions: relatedTransactions.length,
            commissions: relatedCommissions.length,
            driveFiles: driveFileIds.length,
          },
        },
      });
    } catch (error) {
      if (transactionStarted && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    }
  } catch (error) {
    console.error("Error deleting project:", error);
    return res.status(500).json({
      message: error.message || "Failed to delete project",
      error: true,
      success: false,
    });
  } finally {
    await session.endSession();
  }
};

module.exports = deleteOrderController;
