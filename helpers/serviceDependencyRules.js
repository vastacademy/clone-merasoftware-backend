// SSOT for "where can this service be bought" — the one place the admin's own
// `dependency` setting is turned into a decision.
//
// The admin already decides this per service when creating the plan
// (createServicePlan.js makes `dependency` mandatory and freezes it into the
// order snapshot at purchase). Until now nothing ever read it back, so a
// standalone-only service could be attached to a project and a project-required
// service could be bought with no project at all. This module is what the rest
// of the system asks instead of re-deriving the rule anywhere else.
//
// Two purchase surfaces exist, and each one asks the same question here:
//   PROJECT   — the "Add a Service" modal opened from inside a project
//   STANDALONE— the Start New Project catalogue, bought with no project
//
// Timing (`during` | `during_and_after` | `after`) is deliberately NOT part of
// this decision. Every project-compatible service may be bought while a project
// is running; `after` only changes WHEN it starts working, not whether it can be
// purchased. That start-time behaviour is owned by servicePlanPurchase.js /
// serviceLifecycle.js, not by this file.

const SURFACE = {
  PROJECT: "project",
  STANDALONE: "standalone",
};

const DEPENDENCY = {
  PROJECT_REQUIRED: "project_required",
  STANDALONE_OR_PROJECT: "standalone_or_project",
  STANDALONE_ONLY: "standalone_only",
};

// Which surfaces each dependency is allowed on. A service the admin marked
// standalone-only is never attachable to a project; one marked project-required
// can never run on its own.
const ALLOWED_SURFACES = {
  [DEPENDENCY.PROJECT_REQUIRED]: [SURFACE.PROJECT],
  [DEPENDENCY.STANDALONE_OR_PROJECT]: [SURFACE.PROJECT, SURFACE.STANDALONE],
  [DEPENDENCY.STANDALONE_ONLY]: [SURFACE.STANDALONE],
};

// Shown to the customer when a service is listed on a surface it cannot be
// bought from. Phrased as what to do next, not as an error.
const BLOCKED_REASON = {
  [DEPENDENCY.STANDALONE_ONLY]: "This service runs on its own and cannot be attached to a project. It is bought separately.",
  [DEPENDENCY.PROJECT_REQUIRED]: "This service works only alongside a project. Open the project you want it added to.",
};

const readDependency = (servicePlanOrSnapshot) => servicePlanOrSnapshot?.dependency || null;

// The single decision. Returns why it was refused so the caller (API error or
// UI notice) never has to phrase the rule itself.
//
// A service with no dependency set predates the field being mandatory. It is
// allowed everywhere rather than silently hidden — withholding a service the
// admin never restricted would be a stricter rule than the admin set.
const evaluateServiceSurface = (servicePlanOrSnapshot, surface) => {
  const dependency = readDependency(servicePlanOrSnapshot);

  if (!dependency) {
    return { allowed: true, dependency: null, reason: null };
  }

  const allowedSurfaces = ALLOWED_SURFACES[dependency];

  // An unrecognised value is not silently trusted or silently blocked — it is
  // reported, so a bad value surfaces instead of quietly changing behaviour.
  if (!allowedSurfaces) {
    return {
      allowed: false,
      dependency,
      reason: "This service is not configured correctly. Please contact support.",
    };
  }

  if (allowedSurfaces.includes(surface)) {
    return { allowed: true, dependency, reason: null };
  }

  return {
    allowed: false,
    dependency,
    reason: BLOCKED_REASON[dependency] || "This service cannot be bought here.",
  };
};

const canBuyOnSurface = (servicePlanOrSnapshot, surface) =>
  evaluateServiceSurface(servicePlanOrSnapshot, surface).allowed;

module.exports = {
  SURFACE,
  DEPENDENCY,
  ALLOWED_SURFACES,
  evaluateServiceSurface,
  canBuyOnSurface,
};
