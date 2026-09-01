// Reconstructs lifecycle history for orders that predate helpers/orderLifecycleLog.js.
//
// From now on every transition records itself as it happens. This script fills in what can be
// recovered for orders that already exist — and, just as importantly, does NOT invent what
// cannot be. Every entry it writes carries actorType 'backfill' and a `derivedFrom` note naming
// the record the date came from, so a reconstructed timestamp is never mistaken for an observed
// one.
//
// WHAT EACH EVENT IS RECOVERED FROM, and why that source is trustworthy:
//
//   approved     <- the order's earliest COMPLETED transaction.
//                   An order reaches 'approved' when money settles against it (every path in
//                   helpers/orderLifecycle.js does exactly that), so the first completed payment
//                   is when that happened. Orders approved with no payment at all have no source
//                   and are skipped.
//
//   work_started <- the earliest projectNodeEvents entry whose nextProgress is ABOVE 0.
//                   NOT the first node event. Verified against live data: all 29 orders that have
//                   node events have a 0% auto-created node first (initializeProjectTimeline
//                   creates it at order creation), so "first node event" is just createdAt again.
//                   Only 14 orders have ever passed 0% — those are the only ones where work
//                   genuinely started, and the only ones that get this event.
//
//   completed    <- the earliest projectNodeEvents entry reaching nextProgress >= 100.
//
//   cancelled    <- the order's own cancelledAt / cancelledBy / cancellationReason.
//                   These were already recorded properly; this only mirrors them into the
//                   timeline. The actor is real, so this entry is NOT marked 'backfill'.
//
//   rejected     <- NOTHING. No date was ever stored for a rejection (only the reason text), and
//                   no other record carries it. This is unrecoverable and is deliberately left
//                   absent rather than approximated from updatedAt, which any later edit
//                   overwrites. Live data currently has zero rejected orders, so nothing is lost
//                   today — but the gap is real and is stated rather than papered over.
//
// SAFETY: skips any order that already has a lifecycle event of the type being written, so it is
// idempotent and can never double-write. Never touches orderVisibility, status, progress, money
// or any other field — it only appends to lifecycleEvents.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/backfillOrderLifecycleEvents.js
//   node scripts/backfillOrderLifecycleEvents.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const transactionModel = require("../models/transactionModel");
const { LIFECYCLE_EVENT, ACTOR_TYPE, hasEvent } = require("../helpers/orderLifecycleLog");
require("../models/productModel");

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(84));
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "-");

const nameOf = (o) =>
  o.projectSnapshot?.displayName || o.productId?.serviceName ||
  o.servicePlanSnapshot?.serviceName || "(unnamed)";

const isApprovedVisibility = (o) =>
  o.orderVisibility === "approved" || o.orderVisibility === "visible";

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) { line("No Mongo URI found in .env."); process.exit(1); }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);
  await mongoose.connect(uri);
  line(APPLY ? "MODE: APPLY (will write)" : "MODE: DRY-RUN (no writes)");
  line("");

  const orders = await orderModel.find({}).populate("productId", "serviceName").lean();

  const counts = {
    approved: 0, approvedNoSource: 0,
    workStarted: 0, workStartedNoSource: 0,
    completed: 0, completedNoSource: 0,
    cancelled: 0,
    rejectedUnrecoverable: 0,
    alreadyHadEvents: 0,
    ordersTouched: 0,
  };
  const detail = [];

  for (const order of orders) {
    // A plain object from .lean() — hasEvent works on it, and the array is what we append to.
    if (!Array.isArray(order.lifecycleEvents)) order.lifecycleEvents = [];
    if (order.lifecycleEvents.length) counts.alreadyHadEvents++;

    const added = [];
    const nodeEvents = (order.projectNodeEvents || [])
      .slice()
      .sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));

    // ── approved ──
    if (isApprovedVisibility(order) && !hasEvent(order, LIFECYCLE_EVENT.APPROVED)) {
      const firstPayment = await transactionModel
        .findOne({ orderId: order._id, status: "completed" })
        .sort({ createdAt: 1 })
        .select("createdAt verifiedBy")
        .lean();
      if (firstPayment) {
        added.push({
          eventType: LIFECYCLE_EVENT.APPROVED,
          occurredAt: firstPayment.createdAt,
          actorId: firstPayment.verifiedBy || null,
          actorType: ACTOR_TYPE.BACKFILL,
          fromVisibility: null,
          toVisibility: "approved",
          progressAtEvent: null,
          reason: null,
          derivedFrom: "earliest completed transaction",
          metadata: {},
        });
        counts.approved++;
      } else {
        counts.approvedNoSource++;
      }
    }

    // ── work_started ──
    if (order.isWebsiteProject && !hasEvent(order, LIFECYCLE_EVENT.WORK_STARTED)) {
      const firstRealProgress = nodeEvents.find((e) => Number(e.nextProgress) > 0);
      if (firstRealProgress) {
        added.push({
          eventType: LIFECYCLE_EVENT.WORK_STARTED,
          occurredAt: firstRealProgress.occurredAt,
          actorId: firstRealProgress.actorId || null,
          actorType: ACTOR_TYPE.BACKFILL,
          fromVisibility: null,
          toVisibility: null,
          progressAtEvent: Math.round(Number(firstRealProgress.nextProgress) || 0),
          reason: null,
          derivedFrom: "first node event above 0% progress",
          metadata: {},
        });
        counts.workStarted++;
      } else {
        counts.workStartedNoSource++;
      }
    }

    // ── completed ──
    const looksComplete = (order.projectProgress || 0) >= 100 || order.currentPhase === "completed";
    if (order.isWebsiteProject && looksComplete && !hasEvent(order, LIFECYCLE_EVENT.COMPLETED)) {
      const hit100 = nodeEvents.find((e) => Number(e.nextProgress) >= 100);
      if (hit100) {
        added.push({
          eventType: LIFECYCLE_EVENT.COMPLETED,
          occurredAt: hit100.occurredAt,
          actorId: hit100.actorId || null,
          actorType: ACTOR_TYPE.BACKFILL,
          fromVisibility: null,
          toVisibility: null,
          progressAtEvent: 100,
          reason: null,
          derivedFrom: "node event reaching 100%",
          metadata: {},
        });
        counts.completed++;
      } else {
        counts.completedNoSource++;
      }
    }

    // ── cancelled ── real recorded facts, so not marked as backfill
    if (order.cancelledAt && !hasEvent(order, LIFECYCLE_EVENT.CANCELLED)) {
      added.push({
        eventType: LIFECYCLE_EVENT.CANCELLED,
        occurredAt: order.cancelledAt,
        actorId: order.cancelledBy || null,
        actorType: ACTOR_TYPE.ADMIN,
        fromVisibility: null,
        toVisibility: "cancelled",
        progressAtEvent: Math.round(Number(order.projectProgress) || 0),
        reason: order.cancellationReason || null,
        derivedFrom: "order.cancelledAt (recorded at the time, not reconstructed)",
        metadata: {},
      });
      counts.cancelled++;
    }

    // ── rejected ── no source exists anywhere
    if (order.orderVisibility === "payment-rejected" && !hasEvent(order, LIFECYCLE_EVENT.REJECTED)) {
      counts.rejectedUnrecoverable++;
    }

    if (!added.length) continue;
    counts.ordersTouched++;
    added.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
    detail.push({ order, added });

    if (APPLY) {
      await orderModel.updateOne(
        { _id: order._id },
        { $push: { lifecycleEvents: { $each: added, $sort: { occurredAt: 1 } } } }
      );
    }
  }

  for (const row of detail) {
    sep();
    line("ORDER " + row.order._id + "   " + nameOf(row.order));
    line("  created : " + fmt(row.order.createdAt) + "   visibility: " + row.order.orderVisibility +
         "   progress: " + (row.order.projectProgress ?? "-") + "%");
    row.added.forEach((e) =>
      line("    + " + e.eventType.padEnd(13) + fmt(e.occurredAt) + "   from: " + e.derivedFrom));
  }

  sep();
  line("");
  line("SUMMARY");
  line("  orders scanned                 : " + orders.length);
  line("  orders receiving events        : " + counts.ordersTouched);
  line("  orders that already had events : " + counts.alreadyHadEvents + "   (skipped for those types)");
  line("");
  line("  approved     written : " + counts.approved + "    no source: " + counts.approvedNoSource);
  line("  work_started written : " + counts.workStarted + "    no source: " + counts.workStartedNoSource +
       "   (a project that never passed 0% never started)");
  line("  completed    written : " + counts.completed + "    no source: " + counts.completedNoSource);
  line("  cancelled    written : " + counts.cancelled + "    (real recorded facts, not reconstructed)");
  line("  rejected     written : 0    unrecoverable: " + counts.rejectedUnrecoverable +
       "   (no rejection date was ever stored)");
  line("");
  line(APPLY
    ? "APPLIED. Re-run scripts/readOnlyVerifyLifecycleLog.js to confirm."
    : "DRY-RUN complete — nothing was written. Re-run with --apply to write.");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Backfill failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
