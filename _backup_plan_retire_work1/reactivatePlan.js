const uploadProductPermission = require("../../helpers/permission");
const productModel = require("../../models/productModel");

// Undo a retirement. The plan returns to the admin list, but stays hidden from the
// customer catalog until the admin explicitly unhides it — bringing a plan back on
// sale should be a deliberate second step, not a side effect of un-retiring it.
const reactivatePlan = async (req, res) => {
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

    if (!plan.retiredAt) {
      return res.status(409).json({
        message: "This plan is not retired",
        error: true,
        success: false,
      });
    }

    plan.retiredAt = null;
    plan.retiredBy = null;
    // Put the plan back exactly as it was before retirement, rather than leaving it
    // hidden and making the admin re-enable it. Restore means restore.
    // (null = retired before this field existed; stay hidden, which is the safe read.)
    plan.isHidden = plan.hiddenBeforeRetire === null || plan.hiddenBeforeRetire === undefined
      ? true
      : Boolean(plan.hiddenBeforeRetire);
    plan.hiddenBeforeRetire = null;
    await plan.save();

    return res.json({
      message: `"${plan.serviceName}" restored to Active Plans${
        plan.isHidden ? " — still hidden from the catalogue" : " and back on sale"
      }`,
      success: true,
      error: false,
      data: { planId: plan._id, isHidden: plan.isHidden },
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to reactivate the plan",
      error: true,
      success: false,
    });
  }
};

module.exports = reactivatePlan;
