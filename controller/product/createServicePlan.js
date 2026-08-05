const productModel = require("../../models/productModel");

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };
const BILLING_CYCLE_MONTHS = { weekly: null, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

const PLAN_TYPES = ['website_updates', 'digital_marketing', 'google_business_setup', 'social_media_marketing', 'other'];
const LIMIT_SCOPES = ['per_day', 'per_week', 'per_month', 'per_quarter', 'per_6_month', 'per_year', 'per_plan', 'unlimited', 'manual'];
const MANUAL_UNITS = ['day', 'week', 'month'];
const MANUAL_COUNT_MAX = { day: 31, week: 8, month: 12 };
const VALIDITY_UNITS = ['day', 'week', 'month', 'year'];
const BILLING_CYCLES = ['weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
const MAX_FILES_LIMIT = 100;

const createServicePlanController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const body = req.body || {};

    // Explicit whitelist — never spread req.body directly, and never allow
    // the legacy plan-type booleans/fields to be set through this endpoint.
    const serviceName = body.serviceName;
    const planType = body.planType;
    const limitScope = body.limitScope;
    const manualUnit = body.manualUnit;
    const manualCount = body.manualCount;
    const portalAccessCount = body.portalAccessCount;
    const filesLimit = body.filesLimit;
    const validityUnit = body.validityUnit;
    const validityValue = body.validityValue;
    const billingCycle = body.billingCycle;
    const price = body.price;
    const sellingPrice = body.sellingPrice;
    const description = body.description;
    const visibility = body.visibility;

    if (!serviceName || typeof serviceName !== 'string' || !serviceName.trim()) {
      throw new Error("Plan name is required");
    }
    if (!PLAN_TYPES.includes(planType)) {
      throw new Error("A valid plan type is required");
    }
    if (!LIMIT_SCOPES.includes(limitScope)) {
      throw new Error("A valid limit scope is required");
    }

    if (limitScope === 'manual') {
      if (!MANUAL_UNITS.includes(manualUnit)) {
        throw new Error("A valid manual unit is required for manual scope");
      }
      const maxForUnit = MANUAL_COUNT_MAX[manualUnit];
      if (!(Number(manualCount) >= 1) || Number(manualCount) > maxForUnit) {
        throw new Error(`Manual count must be between 1 and ${maxForUnit} for the selected unit`);
      }
    } else if (manualUnit || manualCount) {
      throw new Error("Manual unit/count must be empty unless limit scope is manual");
    }

    if (limitScope === 'unlimited') {
      if (portalAccessCount) {
        throw new Error("Portal access count must be empty when limit scope is unlimited");
      }
    } else if (!(Number(portalAccessCount) >= 1)) {
      throw new Error("Portal access count must be at least 1");
    }

    if (!(Number(filesLimit) >= 1) || Number(filesLimit) > MAX_FILES_LIMIT) {
      throw new Error(`Files limit must be between 1 and ${MAX_FILES_LIMIT}`);
    }

    if (!VALIDITY_UNITS.includes(validityUnit)) {
      throw new Error("A valid validity unit is required");
    }
    if (!(Number(validityValue) >= 1)) {
      throw new Error("Validity value must be at least 1");
    }

    const validityInDays = Number(validityValue) * VALIDITY_UNIT_DAYS[validityUnit];

    if (billingCycle) {
      if (!BILLING_CYCLES.includes(billingCycle)) {
        throw new Error("A valid billing cycle is required");
      }
      if (billingCycle === 'weekly') {
        if (validityInDays < 7) {
          throw new Error("Weekly billing requires a validity of at least 7 days");
        }
      } else {
        const validityInMonths = validityUnit === 'month' ? Number(validityValue)
          : validityUnit === 'year' ? Number(validityValue) * 12
          : null;
        const cycleMonths = BILLING_CYCLE_MONTHS[billingCycle];
        if (validityInMonths === null || validityInMonths % cycleMonths !== 0) {
          throw new Error("Billing cycle must evenly divide the plan's validity duration");
        }
      }
    }

    if (price !== undefined && price !== null && price !== '' && Number(price) < 0) {
      throw new Error("Base price cannot be negative");
    }
    if (sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '' && Number(sellingPrice) < 0) {
      throw new Error("Selling price cannot be negative");
    }

    const planData = {
      serviceName: serviceName.trim(),
      category: "service_plan",
      isServicePlan: true,
      servicePlan: {
        planType,
        limitScope,
        manualUnit: limitScope === 'manual' ? manualUnit : undefined,
        manualCount: limitScope === 'manual' ? Number(manualCount) : undefined,
        portalAccessCount: limitScope === 'unlimited' ? undefined : Number(portalAccessCount),
        filesLimit: Number(filesLimit),
        validityUnit,
        validityValue: Number(validityValue),
        validityInDays,
        billingCycle: billingCycle || undefined,
      },
      price: price !== undefined && price !== null && price !== '' ? Number(price) : undefined,
      sellingPrice: sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '' ? Number(sellingPrice) : undefined,
      formattedDescriptions: description ? [{ content: description }] : [],
      isHidden: visibility === 'hidden',
    };

    const newPlan = new productModel(planData);
    const savedPlan = await newPlan.save();

    return res.status(201).json({
      message: "Plan created successfully",
      error: false,
      success: true,
      data: savedPlan,
    });
  } catch (error) {
    return res.status(400).json({
      message: error.message || "Failed to create plan",
      error: true,
      success: false,
    });
  }
};

module.exports = createServicePlanController;
