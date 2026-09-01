// Deletes a named list of legacy orders, using the SAME rules the app's own delete path uses.
//
// The owner reviewed scripts/readOnlyListOrdersForCleanup.js and chose these 12 old orders for
// permanent removal because their stale records were causing confusion in the project lists.
//
// WHY THIS MIRRORS controller/order/deleteOrder.js RATHER THAN JUST DROPPING DOCUMENTS:
// that controller is the only sanctioned delete in this system, and its behaviour is a
// deliberate design, not incidental:
//
//   - Transactions and invoices are NEVER deleted. They are the record that money moved. The
//     controller instead stamps them with deletedProjectName / deletedProjectType (and, for
//     invoices, the start date, deleted-at date and payment method) so the payment ledger can
//     still name what the money was for once the order document is gone. These 12 orders carry
//     roughly 1.14 lakh of real customer payments across 6 real customers — dropping those rows
//     would silently destroy the accounting history, which is a different and much larger action
//     than the one that was approved.
//   - Records that only exist to serve the order DO get deleted: updateRequestModel,
//     monthlyInvoiceModel, partnerCommissionModel.
//   - Google Drive files attached to the order are removed by the controller. This script does
//     NOT touch Drive (see below).
//   - Everything runs inside one transaction, so a failure part-way leaves nothing half-deleted.
//
// TWO DELIBERATE DIFFERENCES FROM THE CONTROLLER:
//   1. Google Drive files are NOT deleted here. The controller deletes them with production
//      Drive credentials; doing that from a local script is out of scope for this cleanup and
//      is irreversible in a system this script cannot verify. Any Drive files these orders
//      reference are reported and left in place.
//   2. Linked services BLOCK the delete here. The controller only warns about them in the UI
//      because an admin may intend to clear them afterwards; a batch script has no such judgment,
//      and deleting a project out from under a live service would leave that service pointing at
//      nothing. None of the 12 chosen orders has a linked service, so this changes nothing today.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/deleteLegacyOrdersBatch.js
//   node scripts/deleteLegacyOrdersBatch.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel");
const updateRequestModel = require("../models/updateRequestModel");
const partnerCommissionModel = require("../models/partnerCommissionModel");
const userModel = require("../models/userModel");
require("../models/productModel"); // register 'product' so populate('productId') works

// The 12 orders the owner approved for deletion, from the cleanup inventory.
const TARGET_IDS = [
  "67ca900eb74653ac7d14d96a", // College Website        SLN College      785d  price 30000  received 0
  "67e52b857f45d6d5e3eab02d", // CRM Based CMS          Gaurav Vaid      523d  price 12000  received 28000
  "68be8e26fb4b199f2a11d6ae", // Support Portal         SLN College      357d  price  2249  received 2249
  "68d290eabedcbebe30d512ea", // Blogging Website       Mini             342d  price 35000  received 35000
  "68d3adb2bcc4dfda07074f90", // Restaurant Website     sandeep singh    341d  price  8999  received 8999
  "692ac68013c56107623619c9", // Single Update Plan     SLN College      275d  price  3000  received 3000
  "69f24a556f8943f2c409d213", // Local Service Website  sarbjit singh    123d  price     0  received 0
  "69f436896f8943f2c409f21d", // Section Addition       SLN College      122d  price   300  received 300
  "6a0b0f8a23826b27e82ef44a", // Restaurant Website     sandeep singh    105d  price  8999  received 8999
  "6a0b5d1823826b27e82f59cd", // Local Service Website  sandeep singh    104d  price  8999  received 8999
  "6a0bf0af23826b27e82f866c", // Restaurant Website     sandeep singh    104d  price  8999  received 8999
  "6a1010706c1884b60d505dea", // Restaurant Website     sandeep singh    101d  price  8999  received 8999
];

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(90));

const nameOf = (o) =>
  o.projectSnapshot?.displayName ||
  o.productId?.serviceName ||
  o.servicePlanSnapshot?.serviceName ||
  (o.orderItems || []).find((i) => i.type === "main")?.name ||
  o.orderItems?.[0]?.name ||
  "(unnamed)";

const orderTypeOf = (o) => (o.isServicePlan ? "service" : o.isWebsiteProject ? "project" : "plan");

// Drive file ids referenced anywhere on the order — reported, never deleted (see header).
const collectDriveFileIds = (order) => {
  const ids = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    for (const [key, v] of Object.entries(value)) {
      if (typeof v === "string" && /fileId|driveId|driveFileId/i.test(key) && v.trim()) ids.add(v);
      else visit(v);
    }
  };
  visit(order);
  return [...ids];
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);
  await mongoose.connect(uri);
  line(APPLY ? "MODE: APPLY (will delete)" : "MODE: DRY-RUN (nothing will be deleted)");
  line("");

  // ---- plan every order first; refuse the whole batch if anything is unsafe ----
  const plans = [];
  const blockers = [];

  for (const id of TARGET_IDS) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      blockers.push(id + " : not a valid ObjectId");
      continue;
    }
    const order = await orderModel.findById(id).populate("productId", "serviceName").lean();
    if (!order) {
      blockers.push(id + " : no such order (already deleted?)");
      continue;
    }

    const objectId = new mongoose.Types.ObjectId(id);
    const user = order.userId ? await userModel.findById(order.userId).select("name email").lean() : null;

    const linkedServices = await orderModel
      .find({ linkedProjectOrderId: objectId })
      .select("_id servicePlanSnapshot productId servicePlanStatus")
      .populate("productId", "serviceName")
      .lean();

    if (linkedServices.length) {
      blockers.push(id + " : " + linkedServices.length + " linked service(s) point at this order — delete those first");
    }

    plans.push({
      order,
      objectId,
      user,
      linkedServices,
      transactions: await transactionModel.countDocuments({ orderId: objectId }),
      invoices: await invoiceModel.countDocuments({ orderId: objectId }),
      monthlyInvoices: await monthlyInvoiceModel.countDocuments({ orderId: objectId }),
      updateRequests: await updateRequestModel.countDocuments({ updatePlanId: objectId }),
      commissions: await partnerCommissionModel.countDocuments({ orderId: objectId }),
      driveFileIds: collectDriveFileIds(order),
    });
  }

  // ---- report the plan ----
  for (const p of plans) {
    const o = p.order;
    sep();
    line("ORDER " + o._id + "   " + nameOf(o));
    line("  customer          : " + (p.user?.name || "(no user)") + "   " + (p.user?.email || ""));
    line("  type / created    : " + orderTypeOf(o) + "   " + new Date(o.createdAt).toISOString().slice(0, 10));
    line("  price / paid      : " + Number(o.price ?? o.totalAmount ?? 0) + " / " + Number(o.paidAmount || 0));
    line("  state             : visibility=" + o.orderVisibility + "  status=" + o.status + "  progress=" + (o.projectProgress ?? "-") + "%");
    line("");
    line("  WILL BE DELETED:");
    line("    the order document itself            : 1");
    line("    monthly invoices (monthlyInvoiceModel): " + p.monthlyInvoices);
    line("    update requests                       : " + p.updateRequests);
    line("    partner commissions                   : " + p.commissions);
    line("");
    line("  WILL BE KEPT (stamped with the deleted project's name, as deleteOrder.js does):");
    line("    transactions                          : " + p.transactions + "   <- money record preserved");
    line("    invoices                              : " + p.invoices + "   <- money record preserved");
    if (p.driveFileIds.length) {
      line("");
      line("  LEFT UNTOUCHED (this script never deletes Drive files):");
      p.driveFileIds.forEach((f) => line("    drive file: " + f));
    }
    if (p.linkedServices.length) {
      line("");
      line("  BLOCKED BY LINKED SERVICES:");
      p.linkedServices.forEach((s) =>
        line("    " + s._id + "  " + (s.servicePlanSnapshot?.serviceName || s.productId?.serviceName || "(unnamed)")));
    }
  }

  sep();
  line("");
  line("BATCH SUMMARY");
  line("  requested            : " + TARGET_IDS.length);
  line("  resolved & deletable : " + plans.filter((p) => !p.linkedServices.length).length);
  line("  orders to delete     : " + plans.length);
  line("  transactions kept    : " + plans.reduce((s, p) => s + p.transactions, 0));
  line("  invoices kept        : " + plans.reduce((s, p) => s + p.invoices, 0));
  line("  monthly invoices del : " + plans.reduce((s, p) => s + p.monthlyInvoices, 0));
  line("  update requests del  : " + plans.reduce((s, p) => s + p.updateRequests, 0));
  line("  commissions del      : " + plans.reduce((s, p) => s + p.commissions, 0));

  if (blockers.length) {
    line("");
    line("BLOCKERS — nothing will be deleted until these are resolved:");
    blockers.forEach((b) => line("  " + b));
    line("");
    line("Aborting: the batch is all-or-nothing so a partial delete cannot leave the data half-cleaned.");
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    line("");
    line("DRY-RUN complete — nothing was deleted. Re-run with --apply to delete.");
    await mongoose.disconnect();
    return;
  }

  // ---- apply, one transaction for the whole batch ----
  line("");
  line("APPLYING...");
  const session = await mongoose.startSession();
  let started = false;
  try {
    session.startTransaction();
    started = true;

    for (const p of plans) {
      const o = p.order;
      const serviceName = nameOf(o);
      const orderType = orderTypeOf(o);

      // Same stamps deleteOrder.js writes, so the ledger can still name this money.
      await invoiceModel.updateMany(
        { orderId: p.objectId },
        {
          deletedProjectName: serviceName,
          deletedProjectType: orderType,
          deletedProjectStartDate: o.createdAt,
          deletedProjectDeletedAt: new Date(),
          deletedProjectPaymentMethod: o.paymentMethod || null,
        }
      ).session(session);

      await transactionModel.updateMany(
        { orderId: p.objectId },
        { deletedProjectName: serviceName, deletedProjectType: orderType }
      ).session(session);

      await updateRequestModel.deleteMany({ updatePlanId: p.objectId }).session(session);
      await monthlyInvoiceModel.deleteMany({ orderId: p.objectId }).session(session);
      await partnerCommissionModel.deleteMany({ orderId: p.objectId }).session(session);
      await orderModel.deleteOne({ _id: p.objectId }).session(session);

      line("  deleted " + o._id + "  " + serviceName);
    }

    await session.commitTransaction();
    line("");
    line("DONE — " + plans.length + " order(s) deleted. Transactions and invoices were kept and stamped.");
    line("Re-run scripts/readOnlyListOrdersForCleanup.js to confirm the new state.");
  } catch (error) {
    if (started && session.inTransaction()) await session.abortTransaction();
    line("");
    line("FAILED — the transaction was rolled back. Nothing was deleted.");
    throw error;
  } finally {
    await session.endSession();
    await mongoose.disconnect();
  }
};

main().catch(async (error) => {
  console.error("Delete batch failed:", error);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
