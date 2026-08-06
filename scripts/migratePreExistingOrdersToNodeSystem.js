// Migration: pre-existing legacy website-project orders (projectTimelineVersion 0,
// isWebsiteProject true) -> the new dynamic project-node system.
// SAFE BY DEFAULT: runs in dry-run mode unless --apply is passed.
// Dry-run only reads from the DB and prints what WOULD change — no writes.
// --apply performs the actual update, and only after a --backup file has
// been written in the same run (see writeBackup below).
//
// Scope (per user-approved Phase 4 decision, see frontend/src/DOCS/39_...md):
// - Only orders with isWebsiteProject: true and projectTimelineVersion !== 1 are touched.
// - Non-website legacy orders (checkpointCount 0) are explicitly left untouched —
//   projectNodeService.js's assertProjectOrder() only supports isWebsiteProject orders.
// - One node per previously-completed checkpoint (in checkpoint array order), cumulative
//   progress running-summed to match the checkpoint's own percentage — preserves real
//   history instead of collapsing it into a single before/after summary node.
// - Additive only: checkpoints/projectProgress fields are NOT removed or overwritten,
//   only projectNodes/projectRuns/projectNodeEvents/projectTimelineVersion/
//   projectTimelineInitialized are set.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
require("../models/userModel");
const {
  initializeProjectTimeline,
  appendProjectNode,
  syncActiveProjectProgress,
} = require("../helpers/projectNodeService");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const ACTOR_EMAIL = "admin@merasoftware.com";

// Builds the ordered list of nodes to create for one order, from its legacy
// checkpoints array. initializeProjectTimeline() always creates a forced 0%
// starting node first (using the first checkpoint's name as the title);
// every completed checkpoint (including the first, if it was itself completed)
// then becomes its own append step at a running-sum cumulative percentage,
// so no completed work from the legacy data is silently dropped.
const buildMigrationSteps = (checkpoints) => {
  const ordered = [...(checkpoints || [])];
  if (ordered.length === 0) {
    return { startingTitle: "Project Started", appendSteps: [] };
  }

  const startingTitle = ordered[0].name;
  const completed = ordered.filter((cp) => cp.completed);
  const allCompleted = ordered.length > 0 && completed.length === ordered.length;

  let cumulative = 0;
  const rawSteps = completed.map((cp) => {
    cumulative += Number(cp.percentage) || 0;
    return { title: cp.name, cumulativeProgress: Number(Math.min(cumulative, 100).toFixed(2)) };
  });

  // Some legacy checkpoints carry a 0% (or rounding-flattened) weight, so their
  // running-sum lands on the exact same cumulative value as the step before —
  // that would violate the node system's required +0.1% strictly-increasing rule.
  // Rather than artificially inflating the percentage, merge same-value steps into
  // one node (title joined with " + ") so the real percentage is preserved exactly.
  const appendSteps = [];
  rawSteps.forEach((step) => {
    const prev = appendSteps[appendSteps.length - 1];
    if (prev && step.cumulativeProgress <= prev.cumulativeProgress) {
      prev.title = `${prev.title} + ${step.title}`;
    } else {
      appendSteps.push({ ...step });
    }
  });
  if (appendSteps.length > 0 && allCompleted) {
    appendSteps[appendSteps.length - 1].cumulativeProgress = 100;
  }

  return { startingTitle, appendSteps };
};

const writeBackup = (records) => {
  const backupDir = path.join(__dirname, "..", "migration-backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const filePath = path.join(
    backupDir,
    `pre-existing-orders-before-node-migration-${Date.now()}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2));
  return filePath;
};

const run = async () => {
  const shouldApply = hasFlag("apply");

  await mongoose.connect(process.env.MONGODB_URI);

  const userModel = require("../models/userModel");
  const actor = await userModel.findOne({ email: ACTOR_EMAIL }).lean();
  if (!actor) {
    throw new Error(`Actor user not found for email ${ACTOR_EMAIL} — aborting, no changes made.`);
  }

  const legacyOrders = await orderProductModel
    .find({
      isWebsiteProject: true,
      $or: [{ projectTimelineVersion: 0 }, { projectTimelineVersion: { $exists: false } }],
    })
    .populate("userId", "email");

  console.log(`\nMode: ${shouldApply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Actor: ${actor.email} (${actor._id})`);
  console.log(`Found ${legacyOrders.length} legacy website-project order(s) to migrate.\n`);

  const backupSnapshot = legacyOrders.map((o) => o.toObject());

  const results = [];

  for (const order of legacyOrders) {
    const { startingTitle, appendSteps } = buildMigrationSteps(order.checkpoints);

    const before = {
      projectProgress: order.projectProgress,
      status: order.status,
      currentPhase: order.currentPhase,
      checkpointCount: (order.checkpoints || []).length,
      completedCount: (order.checkpoints || []).filter((cp) => cp.completed).length,
    };

    // In dry-run mode, mutate a disposable plain-object stand-in (Mongoose documents
    // don't support a safe deep-clone for this purpose) so nothing touches the real
    // document; in apply mode, mutate the actual document so order.save() persists it.
    const workingOrder = shouldApply
      ? order
      : {
          isWebsiteProject: order.isWebsiteProject,
          projectTimelineInitialized: false,
          projectTimelineVersion: order.projectTimelineVersion,
          projectRuns: [],
          projectNodes: [],
          projectNodeEvents: [],
          projectProgress: order.projectProgress,
          status: order.status,
          currentPhase: order.currentPhase,
        };

    const { node: startNode } = initializeProjectTimeline({
      order: workingOrder,
      startingNodeTitle: startingTitle,
      actorId: actor._id,
    });

    const createdNodes = [{ title: startNode.title, cumulativeProgress: 0 }];
    appendSteps.forEach((step) => {
      appendProjectNode({
        order: workingOrder,
        title: step.title,
        cumulativeProgress: step.cumulativeProgress,
        actorId: actor._id,
      });
      createdNodes.push(step);
    });

    syncActiveProjectProgress(workingOrder);

    const after = {
      projectProgress: workingOrder.projectProgress,
      status: workingOrder.status,
      currentPhase: workingOrder.currentPhase,
      projectTimelineVersion: workingOrder.projectTimelineVersion,
      nodeCount: workingOrder.projectNodes.length,
      nodes: createdNodes,
    };

    results.push({
      orderId: order._id.toString(),
      customerEmail: order.userId?.email,
      before,
      after,
    });
  }

  results.forEach((r) => {
    console.log("----------------------------------------------------");
    console.log(`Order: ${r.orderId} | Customer: ${r.customerEmail}`);
    console.log("BEFORE (legacy fields, unchanged, still present):", JSON.stringify(r.before, null, 2));
    console.log("AFTER (new additive node fields to be set):", JSON.stringify(r.after, null, 2));
  });

  if (!shouldApply) {
    console.log("\nDry run complete. No changes written. Re-run with --apply to write these changes.");
    await mongoose.disconnect();
    return;
  }

  const backupPath = writeBackup(backupSnapshot);
  console.log(`\nBackup written before applying changes: ${backupPath}`);

  for (const order of legacyOrders) {
    await order.save();
  }

  console.log(`\nApplied. ${legacyOrders.length} order(s) migrated to the dynamic node system.`);
  console.log("Legacy fields (checkpoints, etc.) were NOT removed — only additive node fields were set.");

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  });
