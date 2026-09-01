// READ-ONLY verification. Does not write/update/delete anything.
//
// Checks that the lifecycle log (helpers/orderLifecycleLog.js) behaves correctly and that the
// backfill produced sane history on the real records. Run after any change to the log helper,
// the writers that call it, or the backfill script.
//
// Four groups:
//   1. Helper rules, on hand-built orders — so the rules stay verified once live data changes.
//   2. Live data sanity — no impossible orderings, no duplicated once-only events.
//   3. The timeline the API actually returns is correctly ordered and complete.
//   4. Backfill honesty — every reconstructed entry is labelled as such and names its source.
//
// Run:  node scripts/readOnlyVerifyLifecycleLog.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const {
  LIFECYCLE_EVENT,
  ACTOR_TYPE,
  logApproved,
  logRejected,
  logCancelled,
  logWorkStarted,
  logCompleted,
  logReopened,
  buildLifecycleTimeline,
  getCurrentStateSince,
  hasEvent,
} = require("../helpers/orderLifecycleLog");
require("../models/productModel");

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

  // ── 1. helper rules ──
  sep();
  line("LOG HELPER RULES (no database involved)");

  const fresh = () => ({ orderVisibility: "pending-approval", projectProgress: 0, lifecycleEvents: [] });

  const a = fresh();
  logApproved(a, { actorId: null, actorType: ACTOR_TYPE.ADMIN, fromVisibility: "pending-approval" });
  check("approved is recorded", a.lifecycleEvents.length, 1);
  check("approved records the destination", a.lifecycleEvents[0].toVisibility, "approved");
  check("approved records where it came from", a.lifecycleEvents[0].fromVisibility, "pending-approval");

  const b = fresh();
  logWorkStarted(b, { actorType: ACTOR_TYPE.ADMIN });
  logWorkStarted(b, { actorType: ACTOR_TYPE.ADMIN });
  check("work_started is once-only", b.lifecycleEvents.length, 1);

  const c = fresh();
  logCompleted(c, { actorType: ACTOR_TYPE.ADMIN });
  logCompleted(c, { actorType: ACTOR_TYPE.ADMIN });
  check("completed is not recorded twice in a row", c.lifecycleEvents.length, 1);
  logReopened(c, { actorType: ACTOR_TYPE.ADMIN });
  logCompleted(c, { actorType: ACTOR_TYPE.ADMIN });
  check("completed CAN repeat after a reopen", c.lifecycleEvents.length, 3);
  check("and the cycle reads completed -> reopened -> completed",
    c.lifecycleEvents.map((e) => e.eventType),
    ["completed", "reopened", "completed"]);

  const d = fresh();
  logReopened(d, { actorType: ACTOR_TYPE.ADMIN });
  check("reopen without a preceding completion is ignored", d.lifecycleEvents.length, 0);

  const e = fresh();
  const now = new Date();
  logApproved(e, { actorType: ACTOR_TYPE.ADMIN, occurredAt: now });
  logApproved(e, { actorType: ACTOR_TYPE.ADMIN, occurredAt: now });
  check("the same transition in the same moment is one event", e.lifecycleEvents.length, 1);

  const f = fresh();
  logRejected(f, { actorType: ACTOR_TYPE.ADMIN, reason: "Wrong UPI reference" });
  check("rejection keeps its reason", f.lifecycleEvents[0].reason, "Wrong UPI reference");

  const g = fresh();
  logCancelled(g, { actorType: ACTOR_TYPE.ADMIN, reason: "Client withdrew" });
  check("hasEvent finds a recorded event", hasEvent(g, LIFECYCLE_EVENT.CANCELLED), true);
  check("hasEvent does not invent one", hasEvent(g, LIFECYCLE_EVENT.APPROVED), false);

  const h = { createdAt: new Date("2026-01-01"), lifecycleEvents: [] };
  check("timeline of a brand-new order is just its creation", buildLifecycleTimeline(h).length, 1);
  check("and that first entry is the creation", buildLifecycleTimeline(h)[0].eventType, "created");
  check("stateSince falls back to createdAt when nothing has happened",
    new Date(getCurrentStateSince(h)).toISOString(), new Date("2026-01-01").toISOString());

  // ── 2 & 3 & 4. live data ──
  sep();
  line("LIVE DATA");

  const orders = await orderModel.find({}).select(
    "lifecycleEvents createdAt orderVisibility projectProgress currentPhase cancelledAt isWebsiteProject projectNodeEvents userId"
  ).lean();

  line("  orders: " + orders.length);

  const withEvents = orders.filter((o) => (o.lifecycleEvents || []).length);
  line("  orders carrying lifecycle history: " + withEvents.length);

  // no once-only event appears twice
  const doubleStarted = orders.filter(
    (o) => (o.lifecycleEvents || []).filter((x) => x.eventType === LIFECYCLE_EVENT.WORK_STARTED).length > 1
  );
  check("no order has two work_started events", doubleStarted.length, 0);

  // nothing predates the order itself
  const beforeCreation = orders.filter((o) =>
    (o.lifecycleEvents || []).some((x) => new Date(x.occurredAt) < new Date(o.createdAt) - 1000)
  );
  check("no lifecycle event predates its order's creation", beforeCreation.length, 0);

  // work_started CAN legitimately precede approved, so this is reported rather than asserted.
  //
  // It looks impossible but is not, and the live data proves it: order 6a7ab6aa863c085446162465
  // was created 11 Aug, its first node reached 5% the same day, and its only completed payment
  // landed 17 Aug. An admin genuinely started the work before the money was approved. The
  // backfilled `approved` date is the payment date, which is the correct thing to derive it from
  // — the ordering is a fact about how the business ran, not a defect in the reconstruction.
  //
  // Asserting zero here would have meant "fixing" honest data to satisfy an assumption.
  const startedBeforeApproved = orders.filter((o) => {
    const events = o.lifecycleEvents || [];
    const approved = events.find((x) => x.eventType === LIFECYCLE_EVENT.APPROVED);
    const started = events.find((x) => x.eventType === LIFECYCLE_EVENT.WORK_STARTED);
    if (!approved || !started) return false;
    return new Date(started.occurredAt) < new Date(approved.occurredAt) - 1000;
  });
  line("  NOTE  work began before payment approval on " + startedBeforeApproved.length +
       " order(s) — real sequence, not a defect:");
  startedBeforeApproved.forEach((o) => line("          " + o._id));

  // completion must not come before work started, where both exist
  const doneBeforeStarted = orders.filter((o) => {
    const events = o.lifecycleEvents || [];
    const started = events.find((x) => x.eventType === LIFECYCLE_EVENT.WORK_STARTED);
    const done = events.find((x) => x.eventType === LIFECYCLE_EVENT.COMPLETED);
    if (!started || !done) return false;
    return new Date(done.occurredAt) < new Date(started.occurredAt) - 1000;
  });
  check("no project completes before it starts", doneBeforeStarted.length, 0);

  // every cancelled order has its cancellation in the timeline
  const cancelledOrders = orders.filter((o) => o.cancelledAt);
  const cancelledMissingEvent = cancelledOrders.filter((o) => !hasEvent(o, LIFECYCLE_EVENT.CANCELLED));
  check("every cancelled order records the cancellation (" + cancelledOrders.length + " cancelled)",
    cancelledMissingEvent.length, 0);

  // work_started only exists where progress genuinely left 0
  const startedWithoutProgress = orders.filter((o) => {
    if (!hasEvent(o, LIFECYCLE_EVENT.WORK_STARTED)) return false;
    return !(o.projectNodeEvents || []).some((x) => Number(x.nextProgress) > 0);
  });
  check("work_started only where progress actually passed 0%", startedWithoutProgress.length, 0);

  // backfilled entries are honest about being reconstructed
  const allEvents = orders.flatMap((o) => o.lifecycleEvents || []);
  const backfilled = allEvents.filter((x) => x.actorType === ACTOR_TYPE.BACKFILL);
  const backfilledWithoutSource = backfilled.filter((x) => !x.derivedFrom);
  check("every reconstructed entry names its source (" + backfilled.length + " reconstructed)",
    backfilledWithoutSource.length, 0);

  // the timeline the API returns is ordered and starts at creation
  const sampled = orders.filter((o) => (o.lifecycleEvents || []).length).slice(0, 10);
  const badTimelines = sampled.filter((o) => {
    const timeline = buildLifecycleTimeline(o);
    if (timeline[0]?.eventType !== "created") return true;
    for (let i = 1; i < timeline.length; i += 1) {
      if (new Date(timeline[i].occurredAt) < new Date(timeline[i - 1].occurredAt)) return true;
    }
    return false;
  });
  check("timelines start at creation and run forwards", badTimelines.length, 0);

  // ── what history now exists ──
  sep();
  line("HISTORY COVERAGE");
  const countOf = (type) => orders.filter((o) => hasEvent(o, type)).length;
  line("  approved     : " + countOf(LIFECYCLE_EVENT.APPROVED));
  line("  work_started : " + countOf(LIFECYCLE_EVENT.WORK_STARTED));
  line("  completed    : " + countOf(LIFECYCLE_EVENT.COMPLETED));
  line("  cancelled    : " + countOf(LIFECYCLE_EVENT.CANCELLED));
  line("  rejected     : " + countOf(LIFECYCLE_EVENT.REJECTED) + "   (no rejection date was ever stored — unrecoverable)");
  line("");
  line("  reconstructed entries : " + backfilled.length + " of " + allEvents.length +
       "   (shown as 'estimated' in the UI)");

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
