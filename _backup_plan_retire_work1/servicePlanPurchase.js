// Shared Service Plan purchase logic — SSOT for both purchase paths:
//   customerCreateServicePlanOrder.js      (one service, wallet / UPI / combined)
//   customerCreateServicePlanOrdersBulk.js (several services, wallet only)
//
// Everything that decides WHAT a purchased service plan looks like lives here, so
// the two paths can never drift apart on price, duration, cycle dates or snapshot
// shape. Payment mechanics stay in each controller, since they genuinely differ.

const SERVICE_PLAN_CATEGORY = "service_plan";

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

// Cycle length in days per billing cycle. A plan with no billing cycle bills once
// up front, so its "cycle" is simply the whole validity window.
const BILLING_CYCLE_DAYS = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  half_yearly: 180,
  yearly: 365,
  every_2_years: 730,
  every_3_years: 1095,
  every_4_years: 1460,
  every_5_years: 1825,
};

const BILLING_CYCLE_MONTHS = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
  every_2_years: 24,
  every_3_years: 36,
  every_4_years: 48,
  every_5_years: 60,
};

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
const addMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
};

// Selling price wins when set, else base price. Never read from the client.
const resolveServicePlanPrice = (plan) =>
  Number(
    plan.sellingPrice !== undefined && plan.sellingPrice !== null
      ? plan.sellingPrice
      : plan.price
  );

// Prefers the stored derived value, falling back to recomputing it from
// unit + value for any plan saved before validityInDays was derived server-side.
const resolveValidityInDays = (servicePlan = {}) =>
  Number(servicePlan.validityInDays) ||
  (Number(servicePlan.totalBillingCycles) * (BILLING_CYCLE_DAYS[servicePlan.billingCycle] || 0)) ||
  Number(servicePlan.validityValue || 0) * (VALIDITY_UNIT_DAYS[servicePlan.validityUnit] || 0);

const runsIndefinitely = (servicePlan = {}) =>
  !servicePlan.billingCycle &&
  !servicePlan.totalBillingCycles &&
  !servicePlan.validityInDays &&
  !servicePlan.validityValue;

const resolveCustomerBillingSelection = ({ servicePlan = {}, billingCycle, tenureMonths }) => {
  const cycleMonths = BILLING_CYCLE_MONTHS[billingCycle];
  const option = Array.isArray(servicePlan.billingOptions)
    ? servicePlan.billingOptions.find((item) => item.billingCycle === billingCycle)
    : null;
  if (!cycleMonths || !option || !Number.isFinite(Number(option.pricePerCycle)) || Number(option.pricePerCycle) < 0) {
    throw new Error('The selected billing option is not available for this service');
  }
  const hasTenure = tenureMonths !== undefined && tenureMonths !== null && tenureMonths !== '';
  if (hasTenure && (!Number.isInteger(Number(tenureMonths)) || Number(tenureMonths) < cycleMonths || Number(tenureMonths) % cycleMonths !== 0)) {
    throw new Error('Total tenure must be a whole multiple of the selected billing period');
  }
  return {
    billingCycle,
    cycleMonths,
    tenureMonths: hasTenure ? Number(tenureMonths) : null,
    autoRenew: !hasTenure,
    firstPayment: Number(option.pricePerCycle),
  };
};

// Builds the full order document for a purchased service plan: the frozen
// config snapshot, the validity window, and the first service cycle.
//
// The snapshot exists so a later admin edit to the plan template can never
// silently change what a customer already bought.
const buildServicePlanOrderData = ({
  userId,
  plan,
  price,
  validityInDays,
  linkedProjectOrderId = null,
  addedDuringProjectPhase = null,
  startDate = new Date(),
  billingSelection = null,
}) => {
  const servicePlan = plan.servicePlan || {};
  const waitsForProjectCompletion = servicePlan.timing === 'after' && addedDuringProjectPhase === 'in_progress' && linkedProjectOrderId;

  const isCustomerConfigured = Boolean(billingSelection);
  const isIndefinite = isCustomerConfigured ? billingSelection.autoRenew : runsIndefinitely(servicePlan);
  const endDate = waitsForProjectCompletion ? null : (isCustomerConfigured
    ? (billingSelection.tenureMonths ? addMonths(startDate, billingSelection.tenureMonths) : null)
    : (isIndefinite ? null : addDays(startDate, validityInDays)));
  const cycleDays = isCustomerConfigured ? null : (BILLING_CYCLE_DAYS[servicePlan.billingCycle] || validityInDays);
  // A cycle can never outrun the plan's own validity.
  const firstCycleEnd = waitsForProjectCompletion ? null : (isCustomerConfigured
    ? addMonths(startDate, billingSelection.cycleMonths)
    : (isIndefinite ? null : addDays(startDate, Math.min(cycleDays, validityInDays))));

  return {
    userId,
    productId: plan._id,
    quantity: 1,
    price,
    originalPrice: price,
    totalAmount: price,
    // Customer-initiated => admin approval, same as every other customer order.
    // A fully wallet-paid purchase is flipped to approved by the caller.
    orderVisibility: "pending-approval",
    // A service plan is not a project: no timeline, no nodes, no installments.
    isWebsiteProject: false,
    isPartialPayment: false,
    paidAmount: 0,
    remainingAmount: price,
    paymentComplete: false,
    messages: [],
    orderItems: [
      {
        id: plan._id.toString(),
        name: plan.serviceName,
        type: "main",
        quantity: 1,
        originalPrice: price,
        finalPrice: price,
      },
    ],

    // Service Plan tracking
    isServicePlan: true,
    servicePlanSnapshot: {
      planType: servicePlan.planType,
      serviceBehavior: servicePlan.serviceBehavior,
      timing: servicePlan.timing,
      dependency: servicePlan.dependency,
      capability: servicePlan.capability,
      monthlyReferencePrice: servicePlan.monthlyReferencePrice,
      billingOptions: servicePlan.billingOptions || [],
      limitScope: servicePlan.limitScope,
      manualUnit: servicePlan.manualUnit,
      manualCount: servicePlan.manualCount,
      portalAccessCount: servicePlan.portalAccessCount,
      filesLimit: servicePlan.filesLimit,
      validityUnit: servicePlan.validityUnit,
      validityValue: servicePlan.validityValue,
      validityInDays,
      billingCycle: servicePlan.billingCycle,
      totalBillingCycles: servicePlan.totalBillingCycles,
      runsIndefinitely: isIndefinite,
      selectedBillingCycle: billingSelection?.billingCycle,
      selectedBillingCycleMonths: billingSelection?.cycleMonths,
      tenureMonths: billingSelection?.tenureMonths,
      autoRenew: billingSelection?.autoRenew,
    },
    servicePlanStartDate: waitsForProjectCompletion ? null : startDate,
    servicePlanEndDate: endDate,
    serviceCurrentCycleNumber: 1,
    serviceCurrentCycleStart: waitsForProjectCompletion ? null : startDate,
    serviceCurrentCycleEnd: firstCycleEnd,
    serviceSelectedBillingCycle: billingSelection?.billingCycle || null,
    serviceBillingCycleMonths: billingSelection?.cycleMonths || null,
    serviceTenureMonths: billingSelection?.tenureMonths || null,
    serviceAutoRenew: billingSelection?.autoRenew || false,
    serviceNextBillingDate: firstCycleEnd,
    serviceAccessUsedInCycle: 0,
    serviceAccessUsedTotal: 0,
    servicePlanStatus: waitsForProjectCompletion ? "pending_activation" : "active",

    // Add-on linkage (null for a standalone purchase)
    linkedProjectOrderId,
    addedDuringProjectPhase,
  };
};

module.exports = {
  SERVICE_PLAN_CATEGORY,
  BILLING_CYCLE_DAYS,
  BILLING_CYCLE_MONTHS,
  VALIDITY_UNIT_DAYS,
  addDays,
  addMonths,
  resolveServicePlanPrice,
  resolveValidityInDays,
  runsIndefinitely,
  resolveCustomerBillingSelection,
  buildServicePlanOrderData,
};
