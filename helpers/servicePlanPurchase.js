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

const addDays = (date, days) => new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

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
  Number(servicePlan.validityValue || 0) * (VALIDITY_UNIT_DAYS[servicePlan.validityUnit] || 0);

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
}) => {
  const servicePlan = plan.servicePlan || {};

  const endDate = addDays(startDate, validityInDays);
  const cycleDays = BILLING_CYCLE_DAYS[servicePlan.billingCycle] || validityInDays;
  // A cycle can never outrun the plan's own validity.
  const firstCycleEnd = addDays(startDate, Math.min(cycleDays, validityInDays));

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
      limitScope: servicePlan.limitScope,
      manualUnit: servicePlan.manualUnit,
      manualCount: servicePlan.manualCount,
      portalAccessCount: servicePlan.portalAccessCount,
      filesLimit: servicePlan.filesLimit,
      validityUnit: servicePlan.validityUnit,
      validityValue: servicePlan.validityValue,
      validityInDays,
      billingCycle: servicePlan.billingCycle,
    },
    servicePlanStartDate: startDate,
    servicePlanEndDate: endDate,
    serviceCurrentCycleNumber: 1,
    serviceCurrentCycleStart: startDate,
    serviceCurrentCycleEnd: firstCycleEnd,
    serviceAccessUsedInCycle: 0,
    serviceAccessUsedTotal: 0,
    servicePlanStatus: "active",

    // Add-on linkage (null for a standalone purchase)
    linkedProjectOrderId,
    addedDuringProjectPhase,
  };
};

module.exports = {
  SERVICE_PLAN_CATEGORY,
  BILLING_CYCLE_DAYS,
  VALIDITY_UNIT_DAYS,
  addDays,
  resolveServicePlanPrice,
  resolveValidityInDays,
  buildServicePlanOrderData,
};
