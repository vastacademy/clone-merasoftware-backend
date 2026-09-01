// Records WHEN an order changed lifecycle state, and who moved it.
//
// The order document holds the current state; until this existed, nothing held the history.
// `updatedAt` cannot answer "when was this approved" — any later write overwrites it — so that
// question simply had no answer. Cancellation was the sole exception (cancelledAt/cancelledBy/
// cancellationReason on the order), and those fields stay exactly where they are; this only adds
// the timeline entry alongside them.
//
// The append is deliberately a plain in-memory push, not a save: every caller is already inside
// a save (often inside a transaction), and a helper that wrote on its own could commit a history
// entry for a transition that then rolled back. The entry travels with the caller's own write,
// so it lands only if the transition does.
//
// APPEND-ONLY. Nothing edits or removes an entry — a lifecycle record that can be rewritten is
// not a record. Duplicate suppression exists (see appendLifecycleEvent) because several payment
// paths can settle the same order in one request, and the same transition arriving twice is a
// duplicate, not two events.

const LIFECYCLE_EVENT = Object.freeze({
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  WORK_STARTED: "work_started",
  COMPLETED: "completed",
  REOPENED: "reopened",
});

const ACTOR_TYPE = Object.freeze({
  ADMIN: "admin",
  CUSTOMER: "customer",
  SYSTEM: "system",   // cron / settlement with no request behind it
  BACKFILL: "backfill", // reconstructed after the fact, not observed
});

// Two entries of the same type within this window are treated as one transition. A single
// request can reach the same order through more than one settle path (walletPayInstant's
// installment branch and its full-settlement branch, for example), and that is one approval,
// not two.
const DEDUPE_WINDOW_MS = 5000;

const getEvents = (order) => {
  if (!Array.isArray(order.lifecycleEvents)) order.lifecycleEvents = [];
  return order.lifecycleEvents;
};

// Has this order already recorded this transition? Used for the once-per-order events
// (work_started, completed) where a second entry would be wrong rather than merely noisy.
const hasEvent = (order, eventType) =>
  getEvents(order).some((event) => event.eventType === eventType);

const appendLifecycleEvent = (order, {
  eventType,
  actorId = null,
  actorType,
  reason = null,
  occurredAt = new Date(),
  derivedFrom = null,
  metadata = {},
  fromVisibility,
  toVisibility,
}) => {
  if (!order) return null;
  if (!eventType) throw new Error("Lifecycle event requires an eventType");
  if (!actorType) throw new Error("Lifecycle event requires an actorType");

  const events = getEvents(order);

  // Same transition, same moment — one event. Only the LAST entry of this type is compared, not
  // every past one: a completed -> reopened -> completed cycle inside one request is three real
  // transitions, and scanning the whole history would collapse the second completion into the
  // first purely because they happened close together.
  const lastOfType = [...events].reverse().find((event) => event.eventType === eventType);
  const isImmediateRepeat =
    lastOfType &&
    events[events.length - 1]?.eventType === eventType &&
    Math.abs(new Date(lastOfType.occurredAt).getTime() - new Date(occurredAt).getTime()) < DEDUPE_WINDOW_MS;
  if (isImmediateRepeat) return null;

  const entry = {
    eventType,
    occurredAt,
    actorId: actorId || null,
    actorType,
    // Captured from the order as it stands when the event is recorded. Callers that flip
    // visibility BEFORE logging should pass fromVisibility explicitly.
    fromVisibility: fromVisibility !== undefined ? fromVisibility : (order.orderVisibility || null),
    toVisibility: toVisibility !== undefined ? toVisibility : null,
    progressAtEvent: Number.isFinite(Number(order.projectProgress))
      ? Math.round(Number(order.projectProgress))
      : null,
    reason: reason || null,
    derivedFrom,
    metadata,
  };

  events.push(entry);
  return entry;
};

// Convenience wrappers. Each names the transition so call sites read as what happened, and each
// fixes the toVisibility the transition implies rather than leaving it to the caller to remember.
const logApproved = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, fromVisibility, metadata } = {}) =>
  appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.APPROVED,
    actorId,
    actorType,
    fromVisibility,
    toVisibility: "approved",
    metadata,
  });

const logRejected = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, reason = null, fromVisibility, metadata } = {}) =>
  appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.REJECTED,
    actorId,
    actorType,
    reason,
    fromVisibility,
    toVisibility: "payment-rejected",
    metadata,
  });

const logCancelled = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, reason = null, fromVisibility, metadata } = {}) =>
  appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.CANCELLED,
    actorId,
    actorType,
    reason,
    fromVisibility,
    toVisibility: "cancelled",
    metadata,
  });

// Work started = the first time real progress is recorded. NOT the first node event: every
// project timeline is initialised with an auto-created node at 0% (initializeProjectTimeline),
// and that timestamp is the order's creation, not the day work began. Measured on live data,
// all 29 orders with node events have that 0% node first, while only 14 have ever passed 0%.
// Once-only, hence the hasEvent guard.
const logWorkStarted = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, occurredAt, metadata } = {}) => {
  if (hasEvent(order, LIFECYCLE_EVENT.WORK_STARTED)) return null;
  return appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.WORK_STARTED,
    actorId,
    actorType,
    occurredAt,
    metadata,
  });
};

// Completed = progress reached 100%. A project can drop back below 100 and finish again
// (syncActiveProjectProgress handles that reversal), so this is NOT once-only — but a
// re-completion is only recorded after a reopened event, so the pair reads as a real cycle
// rather than a stutter.
const logCompleted = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, occurredAt, metadata } = {}) => {
  const events = getEvents(order);
  const lastRelevant = [...events]
    .reverse()
    .find((e) => e.eventType === LIFECYCLE_EVENT.COMPLETED || e.eventType === LIFECYCLE_EVENT.REOPENED);
  if (lastRelevant && lastRelevant.eventType === LIFECYCLE_EVENT.COMPLETED) return null;
  return appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.COMPLETED,
    actorId,
    actorType,
    occurredAt,
    metadata,
  });
};

// A finished project dropping back below 100%.
const logReopened = (order, { actorId = null, actorType = ACTOR_TYPE.ADMIN, occurredAt, metadata } = {}) => {
  const events = getEvents(order);
  const lastRelevant = [...events]
    .reverse()
    .find((e) => e.eventType === LIFECYCLE_EVENT.COMPLETED || e.eventType === LIFECYCLE_EVENT.REOPENED);
  if (!lastRelevant || lastRelevant.eventType === LIFECYCLE_EVENT.REOPENED) return null;
  return appendLifecycleEvent(order, {
    eventType: LIFECYCLE_EVENT.REOPENED,
    actorId,
    actorType,
    occurredAt,
    metadata,
  });
};

// The timeline a UI renders: lifecycle transitions in the order they happened, oldest first,
// with the order's own creation as the first entry. Creation is synthesised rather than stored —
// createdAt is already an immutable fact on the order, and writing a duplicate of it would be
// one more thing that can disagree with itself.
const buildLifecycleTimeline = (order) => {
  if (!order) return [];
  const entries = [
    {
      eventType: "created",
      occurredAt: order.createdAt,
      actorId: order.userId || null,
      actorType: ACTOR_TYPE.CUSTOMER,
      reason: null,
      derivedFrom: null,
      progressAtEvent: 0,
    },
    ...getEvents(order).map((event) => ({ ...event })),
  ];

  return entries.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
};

// When did the order reach the state it is in now? Powers the "since" a status badge can show.
const getCurrentStateSince = (order) => {
  const events = getEvents(order);
  if (!events.length) return order?.createdAt || null;
  const latest = events.reduce((newest, event) =>
    new Date(event.occurredAt) > new Date(newest.occurredAt) ? event : newest
  );
  return latest.occurredAt;
};

module.exports = {
  LIFECYCLE_EVENT,
  ACTOR_TYPE,
  appendLifecycleEvent,
  hasEvent,
  logApproved,
  logRejected,
  logCancelled,
  logWorkStarted,
  logCompleted,
  logReopened,
  buildLifecycleTimeline,
  getCurrentStateSince,
};
