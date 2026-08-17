const productModel = require("../../models/productModel");

const VALIDITY_UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };
const BILLING_CYCLE_MONTHS = {
  weekly: null, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
  every_2_years: 24, every_3_years: 36, every_4_years: 48, every_5_years: 60
};

const PLAN_TYPES = ['website_updates', 'digital_marketing', 'google_business_setup', 'social_media_marketing', 'other'];
const LIMIT_SCOPES = ['per_day', 'per_week', 'per_month', 'per_quarter', 'per_6_month', 'per_year', 'per_plan', 'unlimited', 'manual'];
const MANUAL_UNITS = ['day', 'week', 'month'];
const MANUAL_COUNT_MAX = { day: 31, week: 8, month: 12 };
const VALIDITY_UNITS = ['day', 'week', 'month', 'year'];
const BILLING_CYCLES = [
  'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly',
  'every_2_years', 'every_3_years', 'every_4_years', 'every_5_years'
];
const SERVICE_BEHAVIORS = ['portal_access_control', 'reminder_only'];
const SERVICE_TIMINGS = ['during', 'during_and_after', 'after'];
const SERVICE_DEPENDENCIES = ['project_required', 'standalone_or_project', 'standalone_only'];
const SERVICE_CAPABILITIES = ['upload_data', 'send_reminders'];
const CATALOGUE_BILLING_CYCLES = [
  'monthly', 'quarterly', 'half_yearly', 'yearly',
  'every_2_years', 'every_3_years', 'every_4_years', 'every_5_years'
];
const CATALOGUE_BILLING_MONTHS = {
  monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
  every_2_years: 24, every_3_years: 36, every_4_years: 48, every_5_years: 60,
};
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
    const serviceBehavior = body.serviceBehavior;
    const timing = body.timing;
    const dependency = body.dependency;
    const capability = body.capability;
    const monthlyReferencePrice = body.monthlyReferencePrice;
    const billingOptions = body.billingOptions;
    const limitScope = body.limitScope;
    const manualUnit = body.manualUnit;
    const manualCount = body.manualCount;
    const portalAccessCount = body.portalAccessCount;
    const filesLimit = body.filesLimit;
    const validityUnit = body.validityUnit;
    const validityValue = body.validityValue;
    const billingCycle = body.billingCycle;
    const totalBillingCycles = body.totalBillingCycles;
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

    // New catalogue form contract. It is intentionally detected by its
    // required fields so old callers using the original service-plan endpoint
    // remain valid until their UI is migrated.
    const isCatalogueContract = timing !== undefined || dependency !== undefined || capability !== undefined || billingOptions !== undefined;
    if (isCatalogueContract) {
      if (!SERVICE_DEPENDENCIES.includes(dependency)) {
        throw new Error("A valid project dependency is required");
      }
      if (dependency !== 'standalone_only' && !SERVICE_TIMINGS.includes(timing)) {
        throw new Error("A valid service availability is required");
      }
      if (dependency === 'standalone_only' && timing) {
        throw new Error("Standalone-only services cannot use a project availability setting");
      }
      if (!SERVICE_CAPABILITIES.includes(capability)) {
        throw new Error("Select whether the service provides upload data or reminders");
      }
      if (monthlyReferencePrice === undefined || monthlyReferencePrice === null || monthlyReferencePrice === '' || Number(monthlyReferencePrice) < 0) {
        throw new Error("Monthly reference price must be zero or more");
      }
      if (!Array.isArray(billingOptions) || billingOptions.length === 0) {
        throw new Error("Enable at least one customer billing option");
      }

      const seenBillingCycles = new Set();
      const normalizedBillingOptions = billingOptions.map((option) => {
        const billingCycleOption = option?.billingCycle;
        const discountPercent = Number(option?.discountPercent);
        if (!CATALOGUE_BILLING_CYCLES.includes(billingCycleOption) || seenBillingCycles.has(billingCycleOption)) {
          throw new Error("Each billing option must be valid and unique");
        }
        if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
          throw new Error("Billing-option discount must be between 0 and 100");
        }
        seenBillingCycles.add(billingCycleOption);
        const pricePerCycle = Number(monthlyReferencePrice) * CATALOGUE_BILLING_MONTHS[billingCycleOption] * (1 - discountPercent / 100);
        return { billingCycle: billingCycleOption, discountPercent, pricePerCycle };
      });

      const isUploadService = capability === 'upload_data';
      if (isUploadService) {
        if (!LIMIT_SCOPES.includes(limitScope)) throw new Error("A valid upload access limit is required");
        if (limitScope === 'unlimited') {
          if (portalAccessCount) throw new Error("Upload attempts must be empty for unlimited access");
        } else if (!(Number(portalAccessCount) >= 1)) {
          throw new Error("Upload attempts must be at least 1");
        }
        if (!(Number(filesLimit) >= 1) || Number(filesLimit) > MAX_FILES_LIMIT) {
          throw new Error(`Files per upload must be between 1 and ${MAX_FILES_LIMIT}`);
        }
      } else if (limitScope || manualUnit || manualCount || portalAccessCount || filesLimit) {
        throw new Error("Reminder services cannot define upload limits");
      }

      const newPlan = new productModel({
        serviceName: serviceName.trim(),
        category: "service_plan",
        isServicePlan: true,
        servicePlan: {
          planType,
          timing: timing || undefined,
          dependency,
          capability,
          // Legacy field remains populated deliberately for existing readers
          // until their lifecycle paths are migrated in the next phases.
          serviceBehavior: isUploadService ? 'portal_access_control' : 'reminder_only',
          limitScope: isUploadService ? limitScope : undefined,
          portalAccessCount: isUploadService && limitScope !== 'unlimited' ? Number(portalAccessCount) : undefined,
          filesLimit: isUploadService ? Number(filesLimit) : undefined,
          monthlyReferencePrice: Number(monthlyReferencePrice),
          billingOptions: normalizedBillingOptions,
        },
        // Listing components still use these generic product prices. The first
        // enabled option provides a truthful entry price until Phase 2 adds the
        // customer's option selector.
        price: normalizedBillingOptions[0].pricePerCycle,
        sellingPrice: normalizedBillingOptions[0].pricePerCycle,
        formattedDescriptions: description ? [{ content: description }] : [],
        isHidden: visibility === 'hidden',
      });
      const savedPlan = await newPlan.save();
      return res.status(201).json({ message: "Service created successfully", error: false, success: true, data: savedPlan });
    }

    if (!SERVICE_BEHAVIORS.includes(serviceBehavior)) {
      throw new Error("A valid service behavior is required");
    }

    // A reminder_only service grants no portal allowance at all — it only runs
    // on a schedule and notifies. Portal access / limit scope / files limit are
    // therefore rejected rather than silently stored as dead config.
    const isReminderOnly = serviceBehavior === 'reminder_only';

    if (isReminderOnly) {
      if (limitScope || manualUnit || manualCount || portalAccessCount || filesLimit) {
        throw new Error("A reminder-only service cannot define portal access, limit scope, or files limit");
      }
    } else {
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
    }

    const hasLegacyValidity = validityUnit || validityValue;
    const hasTotalBillingCycles = totalBillingCycles !== undefined && totalBillingCycles !== null && totalBillingCycles !== '';
    let validityInDays;

    if (hasTotalBillingCycles) {
      if (!BILLING_CYCLES.includes(billingCycle)) {
        throw new Error("A billing type is required when total cycles are set");
      }
      if (!Number.isInteger(Number(totalBillingCycles)) || Number(totalBillingCycles) < 1) {
        throw new Error("Total billing cycles must be a whole number of at least 1");
      }
      if (hasLegacyValidity) {
        throw new Error("Use either billing cycles or the legacy validity fields, not both");
      }
      validityInDays = Number(totalBillingCycles) * (billingCycle === 'weekly' ? 7 : BILLING_CYCLE_MONTHS[billingCycle] * 30);
    } else if (hasLegacyValidity) {
      if (!VALIDITY_UNITS.includes(validityUnit)) {
        throw new Error("A valid validity unit is required");
      }
      if (!(Number(validityValue) >= 1)) {
        throw new Error("Validity value must be at least 1");
      }
      validityInDays = Number(validityValue) * VALIDITY_UNIT_DAYS[validityUnit];
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
    } else if (billingCycle) {
      throw new Error("Total billing cycles are required when a billing type is selected");
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
        serviceBehavior,
        limitScope: isReminderOnly ? undefined : limitScope,
        manualUnit: !isReminderOnly && limitScope === 'manual' ? manualUnit : undefined,
        manualCount: !isReminderOnly && limitScope === 'manual' ? Number(manualCount) : undefined,
        portalAccessCount: isReminderOnly || limitScope === 'unlimited' ? undefined : Number(portalAccessCount),
        filesLimit: isReminderOnly ? undefined : Number(filesLimit),
        validityUnit: hasLegacyValidity ? validityUnit : undefined,
        validityValue: hasLegacyValidity ? Number(validityValue) : undefined,
        validityInDays,
        billingCycle: billingCycle || undefined,
        totalBillingCycles: hasTotalBillingCycles ? Number(totalBillingCycles) : undefined,
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
