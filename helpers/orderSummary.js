const ORDER_SUMMARY_FIELDS = [
  "userId productId projectSnapshot orderItems isWebsiteProject price totalAmount status projectProgress currentPhase isActive updatesUsed",
  "totalYearlyDaysRemaining currentMonthExpiryDate autoRenewalStatus currentMonthUpdatesUsed",
  "currentMonthUpdatesLimit currentMonthUpdatesRemaining orderVisibility planStatus createdAt updatedAt",
  // Cancellation/refund facts — the list badge reads orderVisibility, the detail views read the rest.
  "cancelledAt cancellationReason refunds refundTotal",
].join(" ");

const PRODUCT_SUMMARY_FIELDS = [
  "serviceName category price sellingPrice validityPeriod updateCount isWebsiteUpdate",
  "isMonthlyRenewablePlan yearlyPlanDuration monthlyRenewalCost isUnlimitedUpdates",
  "isMonthlyLimitedPlan monthlyUpdateLimit monthlyRenewalPrice",
].join(" ");

const applyOrderSummary = (query) =>
  query
    .select(ORDER_SUMMARY_FIELDS)
    .populate("productId", PRODUCT_SUMMARY_FIELDS)
    .populate("assignedDeveloper", "name designation avatar status")
    .lean();

module.exports = {
  ORDER_SUMMARY_FIELDS,
  PRODUCT_SUMMARY_FIELDS,
  applyOrderSummary,
};
