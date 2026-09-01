// READ-ONLY verification. Does not write/update/delete anything.
//
// Confirms that the status engine is actually reaching the response payloads it was wired into,
// and that the wiring did not change anything it was not supposed to. Run after any edit to
// helpers/orderStatusEngine.js, helpers/orderSummary.js, controller/order/getOrderDetails.js or
// controller/order/getUserOrder.js.
//
// It checks four things:
//   1. applyOrderSummary() attaches orderState to every order it returns (this is the shared
//      path behind getUserOrder.js, getAdminUserWorkspace.js and getMyPaymentWorkspace.js).
//   2. ORDER_SUMMARY_FIELDS actually selects the columns the engine needs. A missing column does
//      not throw — it silently produces the wrong answer, which is exactly the class of bug this
//      whole change exists to remove, so it is asserted rather than assumed.
//   3. The engine's own rules hold, checked against hand-built orders rather than live data, so
//      the rules stay verified even once the live rows change.
//   4. The two reported bugs are actually fixed on the real records that exhibited them.
//
// Run:  node scripts/readOnlyVerifyStatusEngineWiring.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const { applyOrderSummary, ORDER_SUMMARY_FIELDS } = require("../helpers/orderSummary");
const { getOrderState, STATUS, PHASE } = require("../helpers/orderStatusEngine");
// applyOrderSummary populates both of these; a script that never imports the app's route tree
// must register them itself or populate() throws MissingSchemaError.
require("../models/productModel");
require("../models/developerModel");

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));

let passed = 0;
let failed = 0;
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; line("  PASS  " + name); }
  else { failed++; line("  FAIL  " + name + "\n          expected: " + JSON.stringify(expected) + "\n          actual  : " + JSON.stringify(actual)); }
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { line("No Mongo URI found in .env."); process.exit(1); }
  await mongoose.connect(uri);
  line("connected (read-only verification - this script never writes)");

  // ── 1. engine rules, on constructed orders ──
  sep();
  line("ENGINE RULES (no database involved)");

  const project = (over = {}) => ({ isWebsiteProject: true, orderVisibility: "approved", projectProgress: 0, ...over });

  check("cancelled beats everything, even 100%",
    getOrderState(project({ orderVisibility: "cancelled", projectProgress: 100 })).code, STATUS.CANCELLED);
  check("cancelled phase is cancelled, not completed",
    getOrderState(project({ orderVisibility: "cancelled", projectProgress: 100 })).phase, PHASE.CANCELLED);
  check("rejected order",
    getOrderState(project({ orderVisibility: "payment-rejected" })).code, STATUS.REJECTED);
  check("pending approval",
    getOrderState(project({ orderVisibility: "pending-approval" })).code, STATUS.PENDING_APPROVAL);
  check("100% is completed",
    getOrderState(project({ projectProgress: 100 })).code, STATUS.COMPLETED);
  check("currentPhase 'completed' also counts as done",
    getOrderState(project({ projectProgress: 40, currentPhase: "completed" })).code, STATUS.COMPLETED);
  check("due unpaid invoice outranks progress",
    getOrderState(project({ projectProgress: 40, hasUnpaidInvoice: true })).code, STATUS.PAYMENT_DUE);
  check("0% approved is not-started, not in-progress",
    getOrderState(project({ projectProgress: 0 })).code, STATUS.APPROVED_NOT_STARTED);
  check("45% is in progress",
    getOrderState(project({ projectProgress: 45 })).code, STATUS.IN_PROGRESS);
  check("in-progress label carries the percent",
    getOrderState(project({ projectProgress: 45 })).label, "In Progress · 45%");
  check("schema-default 'visible' is treated as approved",
    getOrderState(project({ orderVisibility: "visible", projectProgress: 45 })).code, STATUS.IN_PROGRESS);

  line("");
  line("  phase derivation (the '1% but Planning' bug)");
  check("0% -> planning", getOrderState(project({ projectProgress: 0 })).phase, PHASE.PLANNING);
  check("1% -> development", getOrderState(project({ projectProgress: 1 })).phase, PHASE.DEVELOPMENT);
  check("60% -> development", getOrderState(project({ projectProgress: 60 })).phase, PHASE.DEVELOPMENT);
  check("99% -> development", getOrderState(project({ projectProgress: 99 })).phase, PHASE.DEVELOPMENT);
  check("100% -> completed", getOrderState(project({ projectProgress: 100 })).phase, PHASE.COMPLETED);
  check("stored currentPhase 'planning' is IGNORED at 60%",
    getOrderState(project({ projectProgress: 60, currentPhase: "planning" })).phase, PHASE.DEVELOPMENT);

  line("");
  line("  services read servicePlanStatus, which no shipping derivation ever did");
  const service = (over = {}) => ({ isServicePlan: true, orderVisibility: "approved", ...over });
  check("paused service is not 'completed'",
    getOrderState(service({ servicePlanStatus: "paused", projectProgress: 100 })).label, "Paused");
  check("expired service",
    getOrderState(service({ servicePlanStatus: "expired" })).label, "Expired");
  check("active service",
    getOrderState(service({ servicePlanStatus: "active" })).code, STATUS.PLAN_ACTIVE);
  check("cancelled service, via its own column",
    getOrderState(service({ servicePlanStatus: "cancelled" })).code, STATUS.CANCELLED);
  check("service has no build phase",
    getOrderState(service({ servicePlanStatus: "active" })).phase, PHASE.NOT_APPLICABLE);

  // ── 2. the fields the engine depends on are actually selected ──
  sep();
  line("ORDER_SUMMARY_FIELDS COVERS WHAT THE ENGINE READS");
  const required = [
    "isWebsiteProject", "isServicePlan", "servicePlanStatus", "orderVisibility",
    "projectProgress", "currentPhase", "planStatus", "isActive",
    "totalYearlyDaysRemaining", "updatesUsed", "projectSnapshot",
  ];
  required.forEach((field) =>
    check("selects " + field, ORDER_SUMMARY_FIELDS.includes(field), true));

  // ── 3. the shared list path really attaches orderState ──
  sep();
  line("applyOrderSummary() ATTACHES orderState");
  const sample = await applyOrderSummary(orderModel.find({}).limit(10));
  check("returned an array", Array.isArray(sample), true);
  check("every order carries orderState",
    sample.every((o) => o && o.orderState && o.orderState.code), true);
  check("every orderState carries a phase",
    sample.every((o) => Boolean(o.orderState.phase)), true);
  check("no order lost its stored fields",
    sample.every((o) => o.orderVisibility !== undefined), true);

  // ── 4. the two reported bugs, on the real records ──
  sep();
  line("THE REPORTED BUGS, ON LIVE RECORDS");

  const cancelled = await orderModel.findOne({ orderVisibility: "cancelled" })
    .populate("productId", "serviceName category").lean();
  if (cancelled) {
    const state = getOrderState(cancelled);
    line("  order " + cancelled._id + "  (stored status=" + cancelled.status + ", progress=" + cancelled.projectProgress + "%)");
    check("cancelled order reports Cancelled, not In Progress", state.code, STATUS.CANCELLED);
    check("its phase is cancelled, not the stored '" + cancelled.currentPhase + "'", state.phase, PHASE.CANCELLED);
  } else {
    line("  (no cancelled order in this database — skipped)");
  }

  const running = await orderModel.findOne({
    isWebsiteProject: true,
    projectProgress: { $gt: 0, $lt: 100 },
    currentPhase: "planning",
    orderVisibility: { $in: ["approved", "visible"] },
  }).populate("productId", "serviceName category").lean();
  if (running) {
    const state = getOrderState(running);
    line("  order " + running._id + "  (progress=" + running.projectProgress + "%, stored currentPhase=" + running.currentPhase + ")");
    check("a running project reports development, not planning", state.phase, PHASE.DEVELOPMENT);
  } else {
    line("  (no in-progress project stuck on 'planning' — skipped)");
  }

  sep();
  line("");
  line("  passed: " + passed + "   failed: " + failed);
  line(failed ? "  VERIFICATION FAILED" : "  all checks passed (nothing was modified)");

  await mongoose.disconnect();
  if (failed) process.exit(1);
};

main().catch(async (error) => {
  console.error("Verification failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
