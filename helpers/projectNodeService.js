const crypto = require("crypto");

const PROJECT_NODE_STATUS = Object.freeze({
  ACTIVE: "active",
  DELETED: "deleted",
  ARCHIVED: "archived",
});

const PROJECT_RUN_STATUS = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
});

const createId = () => crypto.randomUUID();

const getActiveRun = (order) =>
  (order?.projectRuns || []).find((run) => run.status === PROJECT_RUN_STATUS.ACTIVE) || null;

const getActiveNodes = (order, runId = getActiveRun(order)?.runId) =>
  (order?.projectNodes || []).filter(
    (node) => node.runId === runId && node.status === PROJECT_NODE_STATUS.ACTIVE
  );

const getActiveProgress = (order) => {
  const activeNodes = getActiveNodes(order);
  if (activeNodes.length === 0) return 0;
  return Math.max(...activeNodes.map((node) => Number(node.cumulativeProgress) || 0));
};

const syncActiveProjectProgress = (order) => {
  const progress = getActiveProgress(order);
  order.projectProgress = progress;
  if (progress >= 100) {
    order.status = "completed";
    order.currentPhase = "completed";
  } else if (order.status === "completed") {
    order.status = "in_progress";
    order.currentPhase = "development";
  }
  return progress;
};

const assertProjectOrder = (order) => {
  if (!order?.isWebsiteProject) {
    throw new Error("Dynamic project nodes are supported only for project orders");
  }
};

const getRequiredActiveRun = (order) => {
  const run = getActiveRun(order);
  if (!run) throw new Error("Project timeline has no active run");
  return run;
};

const appendProjectNode = ({ order, title, cumulativeProgress, actorId, now = new Date() }) => {
  assertProjectOrder(order);
  const run = getRequiredActiveRun(order);
  const currentProgress = getActiveProgress(order);
  const nextProgress = Number(cumulativeProgress);

  if (!String(title || "").trim()) throw new Error("Node title is required");
  if (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 100) {
    throw new Error("Node progress must be between 0 and 100");
  }
  if (currentProgress >= 100) throw new Error("Project is already at 100% progress");
  if (nextProgress < currentProgress + 0.1 - Number.EPSILON) {
    throw new Error("Node progress must be at least 0.1% above current progress");
  }

  const node = createProjectNode({
    runId: run.runId,
    title,
    cumulativeProgress: nextProgress,
    actorId,
    now,
  });
  order.projectNodes.push(node);
  order.projectNodeEvents.push(createNodeEvent({
    eventType: "node_created",
    runId: run.runId,
    nodeId: node.nodeId,
    actorId,
    previousProgress: currentProgress,
    nextProgress,
    now,
  }));
  syncActiveProjectProgress(order);

  return node;
};

const softDeleteProjectNodes = ({ order, nodeIds, actorId, now = new Date() }) => {
  assertProjectOrder(order);
  const run = getRequiredActiveRun(order);
  const requestedIds = new Set((Array.isArray(nodeIds) ? nodeIds : []).map(String));
  const selectedNodes = (order.projectNodes || []).filter(
    (node) => node.runId === run.runId && node.status === PROJECT_NODE_STATUS.ACTIVE && requestedIds.has(node.nodeId)
  );
  if (selectedNodes.length === 0) throw new Error("No active project nodes selected");

  selectedNodes.forEach((node) => {
    node.status = PROJECT_NODE_STATUS.DELETED;
    node.deletedAt = now;
    node.deletedBy = actorId;
    order.projectNodeEvents.push(createNodeEvent({
      eventType: "node_deleted",
      runId: run.runId,
      nodeId: node.nodeId,
      actorId,
      previousProgress: node.cumulativeProgress,
      nextProgress: getActiveProgress(order),
      now,
    }));
  });

  syncActiveProjectProgress(order);
  return selectedNodes;
};

const restoreProjectNodes = ({ order, nodeIds, actorId, now = new Date() }) => {
  assertProjectOrder(order);
  const run = getRequiredActiveRun(order);
  const requestedIds = new Set((Array.isArray(nodeIds) ? nodeIds : []).map(String));
  const nodes = order.projectNodes || [];
  const selectedNodes = nodes.filter(
    (node) => node.runId === run.runId && node.status === PROJECT_NODE_STATUS.DELETED && requestedIds.has(node.nodeId)
  );
  if (selectedNodes.length === 0) throw new Error("No deleted project nodes selected");

  selectedNodes.forEach((node) => {
    const nodeIndex = nodes.indexOf(node);
    const laterActiveNodeBlocksRestore = nodes.some(
      (candidate, candidateIndex) => candidate.runId === run.runId &&
        candidate.status === PROJECT_NODE_STATUS.ACTIVE &&
        candidateIndex > nodeIndex &&
        Number(candidate.cumulativeProgress) <= Number(node.cumulativeProgress)
    );
    if (laterActiveNodeBlocksRestore) {
      throw new Error(`Node ${node.nodeId} cannot be restored because a later active node has equal or lower progress`);
    }
  });

  selectedNodes.forEach((node) => {
    node.status = PROJECT_NODE_STATUS.ACTIVE;
    node.restoredAt = now;
    node.restoredBy = actorId;
    order.projectNodeEvents.push(createNodeEvent({
      eventType: "node_restored",
      runId: run.runId,
      nodeId: node.nodeId,
      actorId,
      previousProgress: getActiveProgress(order),
      nextProgress: Math.max(getActiveProgress(order), Number(node.cumulativeProgress)),
      now,
    }));
  });

  syncActiveProjectProgress(order);
  return selectedNodes;
};

const setProjectNodeVisibility = ({ order, nodeIds, visibleToClient, actorId, now = new Date() }) => {
  assertProjectOrder(order);
  const run = getRequiredActiveRun(order);
  const requestedIds = new Set((Array.isArray(nodeIds) ? nodeIds : []).map(String));
  const selectedNodes = (order.projectNodes || []).filter(
    (node) => node.runId === run.runId && node.status !== PROJECT_NODE_STATUS.ARCHIVED && requestedIds.has(node.nodeId)
  );
  if (selectedNodes.length === 0) throw new Error("No project nodes selected");

  selectedNodes.forEach((node) => {
    node.visibleToClient = Boolean(visibleToClient);
    order.projectNodeEvents.push(createNodeEvent({
      eventType: "node_visibility_changed",
      runId: run.runId,
      nodeId: node.nodeId,
      actorId,
      metadata: { visibleToClient: node.visibleToClient },
      now,
    }));
  });

  return selectedNodes;
};

const resetProjectTimeline = ({ order, startingNodeTitle, actorId, now = new Date() }) => {
  assertProjectOrder(order);
  const currentRun = getRequiredActiveRun(order);
  const previousProgress = getActiveProgress(order);

  if (!String(startingNodeTitle || "").trim()) throw new Error("Reset starting node title is required");

  currentRun.status = PROJECT_RUN_STATUS.ARCHIVED;
  currentRun.archivedAt = now;
  currentRun.archivedBy = actorId;
  (order.projectNodes || []).forEach((node) => {
    if (node.runId === currentRun.runId) node.status = PROJECT_NODE_STATUS.ARCHIVED;
  });

  order.projectNodeEvents.push(createNodeEvent({
    eventType: "project_reset",
    runId: currentRun.runId,
    actorId,
    previousProgress,
    nextProgress: 0,
    metadata: { archivedRunId: currentRun.runId },
    now,
  }));

  const result = initializeProjectTimeline({ order, startingNodeTitle, actorId, now });
  syncActiveProjectProgress(order);
  return result;
};

const createProjectRun = ({ actorId, now = new Date() } = {}) => ({
  runId: createId(),
  status: PROJECT_RUN_STATUS.ACTIVE,
  startedAt: now,
  startedBy: actorId,
  showToClient: false,
});

const createProjectNode = ({ runId, title, cumulativeProgress, actorId, now = new Date() }) => ({
  nodeId: createId(),
  runId,
  title: String(title || "").trim(),
  cumulativeProgress,
  status: PROJECT_NODE_STATUS.ACTIVE,
  visibleToClient: true,
  createdBy: actorId,
  createdAt: now,
  messageIds: [],
});

const createNodeEvent = ({
  eventType,
  runId,
  nodeId,
  actorId,
  previousProgress,
  nextProgress,
  metadata = {},
  now = new Date(),
}) => ({
  eventType,
  runId,
  nodeId,
  actorId,
  previousProgress,
  nextProgress,
  metadata,
  occurredAt: now,
});

const initializeProjectTimeline = ({ order, startingNodeTitle, actorId, now = new Date() }) => {
  if (!order?.isWebsiteProject) {
    throw new Error("Dynamic project nodes are supported only for project orders");
  }

  if (order.projectTimelineInitialized && getActiveRun(order)) {
    return { order, created: false };
  }

  const run = createProjectRun({ actorId, now });
  const node = createProjectNode({
    runId: run.runId,
    title: startingNodeTitle,
    cumulativeProgress: 0,
    actorId,
    now,
  });

  if (!node.title) {
    throw new Error("Starting node title is required");
  }

  order.projectRuns.push(run);
  order.projectNodes.push(node);
  order.projectNodeEvents.push(createNodeEvent({
    eventType: "node_created",
    runId: run.runId,
    nodeId: node.nodeId,
    actorId,
    previousProgress: 0,
    nextProgress: 0,
    metadata: { reason: "project_started" },
    now,
  }));
  order.projectTimelineInitialized = true;
  order.projectTimelineVersion = 1;
  order.projectProgress = 0;

  return { order, created: true, run, node };
};

module.exports = {
  PROJECT_NODE_STATUS,
  PROJECT_RUN_STATUS,
  getActiveRun,
  getActiveNodes,
  getActiveProgress,
  syncActiveProjectProgress,
  assertProjectOrder,
  appendProjectNode,
  softDeleteProjectNodes,
  restoreProjectNodes,
  setProjectNodeVisibility,
  resetProjectTimeline,
  createProjectRun,
  createProjectNode,
  createNodeEvent,
  initializeProjectTimeline,
};
