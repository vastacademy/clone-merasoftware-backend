// READ-ONLY audit script. Does not write/update/delete anything.
//
// Purpose: readOnlyAuditLegacyPlans.js finds legacy orders by
// `productId: { $in: legacyProductIds }`, so it can only ever see orders whose
// plan row still exists — it structurally cannot find an ORPHAN. This script
// starts from the ORDERS instead, so orders whose productId is null or points at
// a deleted plan are visible, which is exactly the population that crashes
// submitUpdateRequest.js ("Cannot read properties of null (reading 'updateCount')").
//
// Evidence collected here decides whether the legacy limits can be backfilled
// onto the order, or whether they are unrecoverable and need a manual decision.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");

const LEGACY_FIELDS = [
  "updateCount",
  "validityPeriod",
  "isMonthlyRenewablePlan",
  "yearlyPlanDuration",
  "monthlyRenewalCost",
  "isUnlimitedUpdates",
  "isMonthlyLimitedPlan",
  "monthlyUpdateLimit",
  "monthlyRenewalPrice",
];

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const orders = db.collection("orders");
  const products = db.collection("products");

  console.log("\n=== READ-ONLY AUDIT: legacy plan orphans ===\n");
  console.log(`orders total   : ${await orders.countDocuments({})}`);
  console.log(`products total : ${await products.countDocuments({})}`);

  // Legacy = NOT a service plan, but carrying legacy update-plan counters.
  const legacy = await orders
    .find({
      isServicePlan: { $ne: true },
      $or: [
        { updatesUsed: { $exists: true } },
        { currentMonthUpdatesUsed: { $exists: true } },
        { totalYearlyDaysRemaining: { $exists: true } },
      ],
    })
    .toArray();

  console.log(`legacy orders (non-service, has update counters): ${legacy.length}\n`);

  const ids = [...new Set(legacy.map((o) => o.productId).filter(Boolean).map(String))];
  const found = await products
    .find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
    .toArray();
  const byId = new Map(found.map((p) => [String(p._id), p]));

  const buckets = { ok: [], nullRef: [], deleted: [], retired: [], archived: [] };
  for (const o of legacy) {
    if (!o.productId) {
      buckets.nullRef.push(o);
      continue;
    }
    const p = byId.get(String(o.productId));
    if (!p) {
      buckets.deleted.push(o);
      continue;
    }
    if (p.archivedAt) {
      buckets.archived.push({ o, p });
      continue;
    }
    if (p.retiredAt) {
      buckets.retired.push({ o, p });
      continue;
    }
    buckets.ok.push({ o, p });
  }

  console.log("--- BUCKETS ---");
  console.log(`plan alive                        : ${buckets.ok.length}`);
  console.log(`plan RETIRED  (row alive, safe)   : ${buckets.retired.length}`);
  console.log(`plan ARCHIVED (row alive, safe)   : ${buckets.archived.length}`);
  console.log(`plan DELETED  (row gone)          : ${buckets.deleted.length}   <-- CRASHES`);
  console.log(`productId NULL on order           : ${buckets.nullRef.length}   <-- CRASHES`);

  const orphans = [...buckets.deleted, ...buckets.nullRef];
  console.log(`\nTOTAL ORPHANED (crash-causing)    : ${orphans.length}\n`);

  if (orphans.length) {
    console.log("--- ORPHAN DETAIL (what survives on each order) ---");
    for (const o of orphans) {
      const user = await db
        .collection("users")
        .findOne({ _id: o.userId }, { projection: { email: 1 } });
      const name =
        (o.orderItems || []).find((i) => i.type === "main")?.name ||
        o.orderItems?.[0]?.name ||
        "MISSING";
      const onOrder = LEGACY_FIELDS.filter((f) => o[f] !== undefined);
      console.log(`\norder ${o._id}   ${user?.email || "?"}`);
      console.log(`   productId         : ${o.productId || "NULL"}`);
      console.log(`   name on order     : ${name}`);
      console.log(`   price / paid      : ${o.price ?? "-"} / ${o.paidAmount ?? "-"}  complete=${o.paymentComplete}`);
      console.log(`   createdAt         : ${o.createdAt}`);
      console.log(`   isActive          : ${o.isActive}   planStatus=${o.planStatus ?? "-"}`);
      console.log(`   updatesUsed       : ${o.updatesUsed ?? "-"}`);
      console.log(`   monthly used/limit: ${o.currentMonthUpdatesUsed ?? "-"} / ${o.currentMonthUpdatesLimit ?? "-"}`);
      console.log(`   yearlyDaysLeft    : ${o.totalYearlyDaysRemaining ?? "-"}`);
      console.log(`   servicePlanSnap   : ${o.servicePlanSnapshot ? "present" : "ABSENT"}`);
      console.log(`   limits ON ORDER   : ${onOrder.length ? onOrder.join(", ") : "NONE — unrecoverable from the order"}`);
    }
  }

  if (buckets.retired.length || buckets.archived.length) {
    console.log("\n--- RETIRED / ARCHIVED plans (row still readable) ---");
    for (const { o, p } of [...buckets.retired, ...buckets.archived]) {
      console.log(
        `order ${o._id} -> "${p.serviceName}" retired=${p.retiredAt || "-"} archived=${p.archivedAt || "-"} updateCount=${p.updateCount ?? "-"} validity=${p.validityPeriod ?? "-"}`
      );
    }
  }

  const legacyPlans = await products.find({ isWebsiteUpdate: true }).toArray();
  console.log(`\n--- LEGACY PLAN TEMPLATES (isWebsiteUpdate:true): ${legacyPlans.length} ---`);
  for (const p of legacyPlans) {
    console.log(
      `  ${p._id} "${p.serviceName}" updateCount=${p.updateCount ?? "-"} validity=${p.validityPeriod ?? "-"} monthlyLtd=${!!p.isMonthlyLimitedPlan} renewable=${!!p.isMonthlyRenewablePlan} retired=${!!p.retiredAt} archived=${!!p.archivedAt}`
    );
  }

  await mongoose.disconnect();
  console.log("\n=== AUDIT COMPLETE — nothing was written ===\n");
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Audit failed:", error);
    process.exit(1);
  });
