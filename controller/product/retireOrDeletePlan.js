const uploadProductPermission = require("../../helpers/permission");
const productModel = require("../../models/productModel");
const orderModel = require("../../models/orderProductModel");

// One admin action, two safe outcomes — the server decides which, never the client.
//
//   0 purchases  -> hard delete. Nothing references it; a mistake/test entry can go.
//   1+ purchases -> RETIRE. The plan disappears from the catalog and from the admin
//                   list, but the row survives forever so the paid invoices and
//                   order history behind it keep their business record.
//
// Retiring is deliberately NOT the Trash system: Trash permanently purges after 30
// days (controller/trash/trashConstants.js), which would silently destroy the record
// a month later — exactly the outcome this is meant to prevent.
//
// Orders keep their own frozen copy of what was bought (servicePlanSnapshot /
// orderItems), so neither outcome can blank out a customer's purchase history.
const retireOrDeletePlan = async (req, res) => {
  try {
    // NOTE: this helper is async. The older product controllers call it without
    // awaiting, which makes their check always truthy — not repeated here.
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

    if (plan.retiredAt) {
      return res.status(409).json({
        message: "This plan is already retired",
        error: true,
        success: false,
      });
    }

    // The authority for the decision. Counted server-side against real orders —
    // the client never says how many customers a plan has.
    const purchaseCount = await orderModel.countDocuments({ productId: plan._id });

    if (purchaseCount === 0) {
      await productModel.findByIdAndDelete(plan._id);
      return res.json({
        message: `"${plan.serviceName}" deleted`,
        success: true,
        error: false,
        data: { action: "deleted", planId: plan._id, purchaseCount: 0 },
      });
    }

    plan.retiredAt = new Date();
    plan.retiredBy = req.userId;
    // Remove IS the disable. There is no separate availability switch on the plans
    // page any more — a plan is either live in Active Plans or disabled in Retired
    // Plans, and only Remove/Restore move it between the two. Setting isHidden here
    // keeps every pre-existing catalogue filter (which already checks isHidden)
    // excluding it, without the admin having to do a second thing.
    plan.isHidden = true;
    await plan.save();

    return res.json({
      message: `"${plan.serviceName}" retired — ${purchaseCount} existing purchase${
        purchaseCount === 1 ? "" : "s"
      } kept intact`,
      success: true,
      error: false,
      data: { action: "retired", planId: plan._id, purchaseCount },
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to remove the plan",
      error: true,
      success: false,
    });
  }
};

module.exports = retireOrDeletePlan;
