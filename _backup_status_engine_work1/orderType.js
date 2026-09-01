export const PROJECT_CATEGORIES = new Set([
  'standard_websites',
  'dynamic_websites',
  'cloud_software_development',
  'app_development',
  'web_applications',
  'mobile_apps',
]);

export const PLAN_CATEGORIES = new Set(['website_updates', 'service_plan']);

export const isProjectItem = (order) =>
  Boolean(order?.isWebsiteProject) || PROJECT_CATEGORIES.has(order?.projectSnapshot?.category?.toLowerCase()) || PROJECT_CATEGORIES.has(order?.productId?.category?.toLowerCase());

export const isPlanItem = (order) =>
  PLAN_CATEGORIES.has(order?.productId?.category?.toLowerCase());

// A finished item is a completed project or a closed plan. Same conditions used
// by ProjectsAndPlans.js's getStatusMeta, kept here so every list ranks it the
// same way (single source of truth).
export const isFinishedItem = (order) => {
  if (isProjectItem(order)) {
    return order?.projectProgress >= 100 || order?.currentPhase === 'completed';
  }
  if (isPlanItem(order)) {
    return (
      order?.planStatus === 'closed' ||
      !order?.isActive ||
      (order?.productId?.isMonthlyRenewablePlan || order?.productId?.isMonthlyLimitedPlan
        ? (order?.totalYearlyDaysRemaining || 0) <= 0
        : (order?.updatesUsed || 0) >= (order?.productId?.updateCount || 0))
    );
  }
  return false;
};

// Rank finished items last; within the same rank, latest update first.
// Used by both the dashboard "recent" list and the Projects & Plans list.
export const sortItemsLatestFirst = (a, b) => {
  const rankDiff = (isFinishedItem(a) ? 1 : 0) - (isFinishedItem(b) ? 1 : 0);
  if (rankDiff !== 0) return rankDiff;
  return new Date(b?.updatedAt || b?.createdAt || 0) - new Date(a?.updatedAt || a?.createdAt || 0);
};
