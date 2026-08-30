const mongoose = require("mongoose");
const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const { buildRefundBreakdown, refundOrderToSource } = require("../../helpers/orderRefundService");
const { createNotification } = require("../../helpers/notificationService");
const { sendProjectCancellationEmail } = require("../../helpers/emailService");
const { getOrderDisplayName } = require("../../helpers/orderPresentation");

// Admin-only project cancellation.
//
// Cancelling is the step that was missing between "project is running" and "project is deleted".
// Deleting used to be the only way to stop a project, which meant the money was never settled —
// there was no point in the flow where a refund could happen. Now the money is settled here,
// while the order and its payment records still exist, and delete becomes cleanup only.
//
// SSOT: the refund itself lives in helpers/orderRefundService.js — this controller never moves
// money on its own. It validates, calls the engine, then records the cancellation and tells the
// customer what happened.

const requireAdmin = async (req, res) => {
  const adminUser = await userModel.findById(req.userId).select("roles");
  if (req.userRole !== "admin" || !adminUser?.roles?.includes("admin")) {
    res.status(403).json({ message: "Forbidden", error: true, success: false });
    return false;
  }
  return true;
};

const loadCancellableOrder = async (orderId, res) => {
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    res.status(400).json({ message: "Valid orderId is required", error: true, success: false });
    return null;
  }

  const order = await orderModel.findById(orderId).populate("productId", "serviceName category");
  if (!order) {
    res.status(404).json({ message: "Order not found", error: true, success: false });
    return null;
  }

  return order;
};

// Preview — what would be refunded, and which methods need a reference id from the admin.
// Read-only: nothing is written, so the admin can open the cancel dialog safely.
const getProjectCancellationPreview = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const order = await loadCancellableOrder(req.params.orderId, res);
    if (!order) return;

    const breakdown = await buildRefundBreakdown(order._id);

    return res.status(200).json({
      message: "Cancellation preview",
      success: true,
      error: false,
      data: {
        orderId: String(order._id),
        projectName: getOrderDisplayName(order),
        alreadyCancelled: order.orderVisibility === "cancelled",
        cancelledAt: order.cancelledAt || null,
        ...breakdown,
      },
    });
  } catch (error) {
    console.error("Error building cancellation preview:", error);
    return res.status(500).json({
      message: error.message || "Failed to build cancellation preview",
      error: true,
      success: false,
    });
  }
};

const cancelProjectOrder = async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;

    const order = await loadCancellableOrder(req.params.orderId, res);
    if (!order) return;

    if (order.orderVisibility === "cancelled") {
      return res.status(400).json({
        message: "This project is already cancelled",
        error: true,
        success: false,
      });
    }

    const { reason, referenceIds = {} } = req.body || {};

    // The refund runs first. If it refuses (a missing reference id for an external leg), the
    // order is left completely untouched — a project must never end up cancelled with its
    // money half-settled.
    const { refunds, refundTotal } = await refundOrderToSource({
      order,
      actorId: req.userId,
      referenceIds,
    });

    // Re-read: refundOrderToSource writes refunds/refundTotal and the reversal saves the order,
    // so the in-memory copy above is stale by now.
    const cancelledOrder = await orderModel.findById(order._id);
    cancelledOrder.orderVisibility = "cancelled";
    cancelledOrder.cancelledAt = new Date();
    cancelledOrder.cancelledBy = req.userId;
    cancelledOrder.cancellationReason = reason?.trim() || null;
    await cancelledOrder.save();

    // Telling the customer is best-effort — a failed email must never undo a completed refund.
    const customer = await userModel.findById(order.userId).select("name email");
    const projectName = getOrderDisplayName(order);

    if (customer) {
      const refundLine = refundTotal > 0
        ? ` A refund of ₹${refundTotal.toLocaleString()} has been processed.`
        : "";
      try {
        await createNotification({
          userId: order.userId,
          type: "project_cancelled",
          title: "Project Cancelled",
          message: `Your project "${projectName}" has been cancelled.${refundLine}`,
          relatedId: order._id,
          onModel: "OrderProduct",
        });
      } catch (notifyError) {
        console.error("Cancellation notification failed:", notifyError);
      }

      try {
        await sendProjectCancellationEmail(customer, order, refunds, cancelledOrder.cancellationReason || "");
      } catch (emailError) {
        console.error("Cancellation email failed:", emailError);
      }
    }

    return res.status(200).json({
      message: "Project cancelled successfully",
      success: true,
      error: false,
      data: {
        orderId: String(order._id),
        projectName,
        cancelledAt: cancelledOrder.cancelledAt,
        refunds,
        refundTotal,
      },
    });
  } catch (error) {
    console.error("Error cancelling project:", error);
    return res.status(500).json({
      message: error.message || "Failed to cancel project",
      error: true,
      success: false,
    });
  }
};

module.exports = { cancelProjectOrder, getProjectCancellationPreview };
