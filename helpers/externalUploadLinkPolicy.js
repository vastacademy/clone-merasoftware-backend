const orderModel = require("../models/orderProductModel");
const userModel = require("../models/userModel");
const { getUploadKind, UPLOAD_KIND } = require("./uploadType");

// Generation only proves ownership and supported record type. It deliberately does
// not enforce temporary upload state: the admin may always prepare a link, while the
// existing upload controller re-checks live limits when that link is actually used.
const resolveEligibleUploadTarget = async ({ customerId, orderId }) => {
  const customer = await userModel.findOne({ _id: customerId, isGuest: { $ne: true }, deletedAt: null }).select("_id isActive mustResetPassword allowLoginFreeUploadLinks").lean();
  if (!customer) throw new Error("Client is not eligible for upload links");
  const order = await orderModel.findOne({ _id: orderId, userId: customer._id }).select("_id userId isWebsiteProject isServicePlan orderVisibility projectProgress currentPhase servicePlanSnapshot servicePlanStatus isActive planStatus autoRenewalStatus").lean();
  if (!order) throw new Error("Selected client record was not found");
  const kind = getUploadKind(order);
  if (kind === UPLOAD_KIND.LEGACY) throw new Error("Only current projects and upload services support external links");
  if (kind === UPLOAD_KIND.SERVICE) {
    const snapshot = order.servicePlanSnapshot || {};
    if (snapshot.capability !== "upload_data" && snapshot.serviceBehavior !== "portal_access_control") throw new Error("Selected service does not provide data upload");
  }
  return { customer, order, kind };
};

module.exports = { resolveEligibleUploadTarget };
