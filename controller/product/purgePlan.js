const uploadProductPermission = require("../../helpers/permission");
const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");

// "Delete Forever" — only reachable for a plan that is ALREADY RETIRED.
//
// Retirement is the gate on purpose: a plan can only be destroyed after it has
// first been deliberately withdrawn and had a chance to sit in the Retired tab.
// There is no way to jump straight from the working catalogue to destruction.
//
// Two modes:
//
//   ARCHIVE (default)  — sets archivedAt. The row is kept, so every order,
//                        invoice and transaction that references it stays whole,
//                        but it disappears from every list including the Retired
//                        tab. To the admin this reads as a permanent delete; to
//                        the database it is recoverable.
//
//   HARD (privileged)  — actually removes the row. Requires an explicit
//                        `mode: "hard"` AND a typed confirmation of the plan's
//                        own name, so it can never happen by a stray click.
//
// Why archive is the default: this system has already been damaged by unguarded
// hard deletes — 4 of 31 orders were found orphaned, one of them with money paid.
// Orders now freeze their own name (servicePlanSnapshot.serviceName), so a hard
// delete no longer blanks a customer's history; but keeping the row costs nothing
// and keeps the mistake recoverable.
const purgePlan = async (req, res) => {
  try {
    const isAdmin = await uploadProductPermission(req.userId);
    if (!isAdmin) {
      return res.status(403).json({
        message: "Permission denied",
        error: true,
        success: false,
      });
    }

    const planId = req.params.planId || req.body?._id;
    if (!planId) {
      return res.status(400).json({
        message: "Plan ID is required",
        error: true,
        success: false,
      });
    }

    const plan = await productModel.findById(planId);
    if (!plan) {
      return res.status(404).json({
        message: "Plan not found",
        error: true,
        success: false,
      });
    }

    // The gate. Destruction is only ever reachable from the Retired tab.
    if (!plan.retiredAt) {
      return res.status(409).json({
        message: "Only a retired plan can be deleted forever. Remove it first.",
        error: true,
        success: false,
      });
    }

    if (plan.archivedAt) {
      return res.status(409).json({
        message: "This plan has already been deleted",
        error: true,
        success: false,
      });
    }

    // Reported back so the UI can state the real consequence rather than a guess.
    const purchaseCount = await orderModel.countDocuments({ productId: plan._id });

    const mode = req.body?.mode === "hard" ? "hard" : "archive";

    if (mode === "hard") {
      // Privileged path: the admin must retype the plan's exact name. This is the
      // only operation in the system that destroys a row other records point at.
      const typed = String(req.body?.confirmName || "").trim();
      if (typed !== String(plan.serviceName || "").trim()) {
        return res.status(400).json({
          message: "Type the plan's exact name to permanently delete it",
          error: true,
          success: false,
        });
      }

      await productModel.findByIdAndDelete(plan._id);

      return res.json({
        message: `"${plan.serviceName}" permanently deleted from the database`,
        success: true,
        error: false,
        data: { action: "hard_deleted", planId: plan._id, purchaseCount },
      });
    }

    plan.archivedAt = new Date();
    plan.archivedBy = req.userId;
    await plan.save();

    return res.json({
      message: `"${plan.serviceName}" deleted`,
      success: true,
      error: false,
      data: { action: "archived", planId: plan._id, purchaseCount },
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to delete the plan",
      error: true,
      success: false,
    });
  }
};

module.exports = purgePlan;
