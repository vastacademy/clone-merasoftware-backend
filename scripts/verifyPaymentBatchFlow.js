/**
 * End-to-end verification for the payment-batch refactor. Runs the REAL controllers
 * (customerCreateServicePlanOrdersBulk + transactionApprovalController) against the live
 * DB with fake req/res objects, then asserts the resulting records, and finally deletes
 * everything it created so the DB is left exactly as it was found.
 *
 * Covers: bulk UPI approve, bulk UPI reject, bulk combined (wallet+UPI) reject-refund,
 * and the guard that blocks settling a batch child on its own.
 *
 * Usage: node scripts/verifyPaymentBatchFlow.js
 */
require("dotenv").config();
const mongoose = require("mongoose");

const userModel = require("../models/userModel");
const productModel = require("../models/productModel");
const orderModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const paymentBatchModel = require("../models/paymentBatchModel");

const bulkController = require("../controller/order/customerCreateServicePlanOrdersBulk");
const { approveTransaction, rejectTransaction } = require("../controller/user/transactionApprovalController");

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// Minimal express-like res capture.
const mockRes = () => {
  const res = {};
  res.statusCode = null;
  res.body = null;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
};

const createdOrderIds = [];
const createdBatchRefs = [];
let testUserId = null;

let planSelections = [];

const runBulk = async ({ planIds, txnId, upiTxnId }) => {
  const res = mockRes();
  await bulkController(
    { userId: testUserId, body: { planIds, transactionId: txnId, upiTransactionId: upiTxnId, selections: planSelections } },
    res
  );
  if (res.body?.data?.orders) createdOrderIds.push(...res.body.data.orders.map((o) => String(o.orderId)));
  if (res.body?.data?.batchRef) createdBatchRefs.push(res.body.data.batchRef);
  return res;
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  // ---- Fixtures: a throwaway customer + two real service plans from the catalogue ----
  const plans = await productModel
    .find({ category: "service_plan", isServicePlan: true, isHidden: { $ne: true } })
    .limit(2)
    .lean();

  if (plans.length < 2) {
    console.log("SKIPPED — need at least 2 available service plans in the catalogue to test a batch.");
    await mongoose.disconnect();
    return;
  }

  const user = await userModel.create({
    name: "ZZ Batch Flow Test",
    email: `zz-batch-test-${Date.now()}@example.invalid`,
    password: "x",
    roles: ["customer"],
    walletBalance: 0,
  });
  testUserId = String(user._id);

  const planIds = plans.map((p) => String(p._id));
  const planTotal = plans.reduce((sum, p) => sum + Number(p.sellingPrice || p.price || 0), 0);

  // Plans that define billingOptions require the customer's chosen cycle, exactly as
  // AddServiceModal.js sends it. Plans without options take none.
  planSelections = plans
    .filter((p) => Array.isArray(p.servicePlan?.billingOptions) && p.servicePlan.billingOptions.length)
    .map((p) => ({
      planId: String(p._id),
      selectedBillingCycle: p.servicePlan.billingOptions[0].billingCycle,
      tenureMonths: 12,
    }));

  console.log(`\nFixtures: user=${testUserId}, plans=[${plans.map((p) => p.serviceName).join(", ")}], total≈${planTotal}\n`);

  // =====================================================================
  // CASE 1 — Bulk, pure UPI (wallet balance 0), then APPROVE
  // =====================================================================
  console.log("--- CASE 1: bulk UPI -> approve ---");
  const txn1 = `ZZTEST${Date.now()}A`;
  const buy1 = await runBulk({ planIds, txnId: txn1, upiTxnId: "111111111111" });
  check("bulk purchase created", buy1.statusCode === 201, buy1.body?.message);
  if (buy1.statusCode !== 201) {
    console.log("\nAborting — the fixture purchase failed, later cases would be meaningless.");
    await userModel.deleteOne({ _id: user._id });
    await mongoose.disconnect();
    process.exit(1);
  }

  const batch1 = await paymentBatchModel.findOne({ batchRef: txn1 });
  check("batch record created in paymentBatchModel", Boolean(batch1), batch1 ? `status=${batch1.status}` : "missing");
  check("batch is NOT in transactionModel", !(await transactionModel.exists({ transactionId: txn1 })));

  const noOrphan1 = await transactionModel.countDocuments({
    userId: user._id, orderId: null, type: { $ne: "deposit" },
  });
  check("no orderId-less payment transaction created", noOrphan1 === 0, `found ${noOrphan1}`);

  const children1 = await transactionModel.find({ parentTransactionId: txn1 }).lean();
  check("one child transaction per service", children1.length === plans.length, `children=${children1.length}`);
  check("every child carries its own orderId", children1.every((c) => c.orderId));

  // Guard: a child must not be approvable on its own.
  const guardRes = mockRes();
  await approveTransaction(
    { userRole: "admin", userId: String(user._id), params: { transactionId: children1[0].transactionId } },
    guardRes
  );
  check("child cannot be approved individually", guardRes.statusCode === 400, guardRes.body?.message);

  // Approve the batch.
  const approveRes = mockRes();
  await approveTransaction({ userRole: "admin", userId: String(user._id), params: { transactionId: txn1 } }, approveRes);
  check("batch approved", approveRes.statusCode === 200, approveRes.body?.message);

  const batch1After = await paymentBatchModel.findOne({ batchRef: txn1 }).lean();
  check("batch status -> approved", batch1After?.status === "approved");

  const children1After = await transactionModel.find({ parentTransactionId: txn1 }).lean();
  check("all children completed", children1After.every((c) => c.status === "completed"));

  const orders1 = await orderModel.find({ _id: { $in: children1After.map((c) => c.orderId) } }).lean();
  check("all service orders approved", orders1.every((o) => o.orderVisibility === "approved"), orders1.map((o) => o.orderVisibility).join(","));

  // The cycle invoice (invoiceType 'project') is what this payment settles. A recurring
  // service also keeps a 'service_statement' invoice for the whole contracted tenure, which
  // stays partially_paid until every cycle is billed — not part of this payment.
  const invoices1 = await invoiceModel.find({ orderId: { $in: orders1.map((o) => o._id) } }).lean();
  const cycleInvoices1 = invoices1.filter((i) => i.invoiceType !== "service_statement");
  check(
    "every cycle invoice this payment covers is paid",
    cycleInvoices1.length > 0 && cycleInvoices1.every((i) => i.status === "paid"),
    cycleInvoices1.map((i) => `${i.invoiceType}:${i.status}`).join(",")
  );

  // =====================================================================
  // CASE 2 — Bulk, pure UPI, then REJECT
  // =====================================================================
  console.log("\n--- CASE 2: bulk UPI -> reject ---");
  const txn2 = `ZZTEST${Date.now()}B`;
  const buy2 = await runBulk({ planIds, txnId: txn2, upiTxnId: "222222222222" });
  check("second bulk purchase created", buy2.statusCode === 201);

  const rejectRes = mockRes();
  await rejectTransaction(
    { userRole: "admin", userId: String(user._id), params: { transactionId: txn2 }, body: { rejectionReason: "test reject" } },
    rejectRes
  );
  check("batch rejected", rejectRes.statusCode === 200, rejectRes.body?.message);

  const batch2After = await paymentBatchModel.findOne({ batchRef: txn2 }).lean();
  check("batch status -> rejected", batch2After?.status === "rejected");

  const children2After = await transactionModel.find({ parentTransactionId: txn2 }).lean();
  check("all children rejected", children2After.every((c) => c.status === "rejected"));

  const orders2 = await orderModel.find({ _id: { $in: children2After.map((c) => c.orderId) } }).lean();
  check("service orders marked payment-rejected", orders2.every((o) => o.orderVisibility === "payment-rejected"), orders2.map((o) => o.orderVisibility).join(","));

  // =====================================================================
  // CASE 3 — Bulk, COMBINED (wallet covers part), then REJECT -> wallet refunded
  // =====================================================================
  console.log("\n--- CASE 3: bulk combined (wallet+UPI) -> reject refunds wallet ---");
  const walletSeed = Math.max(1, Math.floor(planTotal / 2));
  await userModel.findByIdAndUpdate(user._id, { walletBalance: walletSeed });

  const txn3 = `ZZTEST${Date.now()}C`;
  const buy3 = await runBulk({ planIds, txnId: txn3, upiTxnId: "333333333333" });
  check("combined bulk purchase created", buy3.statusCode === 201, `walletPaid=${buy3.body?.data?.walletPaid}, upiPending=${buy3.body?.data?.upiPending}`);

  const balanceAfterBuy = (await userModel.findById(user._id).select("walletBalance").lean())?.walletBalance;
  check("wallet debited at purchase", Number(balanceAfterBuy) === 0, `balance=${balanceAfterBuy}`);

  const batch3 = await paymentBatchModel.findOne({ batchRef: txn3 }).lean();
  check("combined batch records wallet/upi split", batch3?.walletPart === walletSeed, `walletPart=${batch3?.walletPart}, upiPart=${batch3?.upiPart}`);
  check("combined batch paymentMethod", batch3?.paymentMethod === "combined", batch3?.paymentMethod);

  const reject3 = mockRes();
  await rejectTransaction(
    { userRole: "admin", userId: String(user._id), params: { transactionId: txn3 }, body: { rejectionReason: "test combined reject" } },
    reject3
  );
  check("combined batch rejected", reject3.statusCode === 200);

  const balanceAfterReject = (await userModel.findById(user._id).select("walletBalance").lean())?.walletBalance;
  check("wallet portion refunded on reject", Number(balanceAfterReject) === walletSeed, `balance=${balanceAfterReject}, expected=${walletSeed}`);

  // =====================================================================
  // Final invariant
  // =====================================================================
  console.log("\n--- Final invariant ---");
  const orphanFinal = await transactionModel.countDocuments({ userId: user._id, orderId: null, type: { $ne: "deposit" } });
  check("no orderId-less payment transactions exist at all", orphanFinal === 0, `found ${orphanFinal}`);

  // =====================================================================
  // Teardown — remove everything this script created.
  // =====================================================================
  const allOrderIds = [...new Set(createdOrderIds)];
  await invoiceModel.deleteMany({ orderId: { $in: allOrderIds } });
  await orderModel.deleteMany({ _id: { $in: allOrderIds } });
  await transactionModel.deleteMany({ userId: user._id });
  await paymentBatchModel.deleteMany({ batchRef: { $in: createdBatchRefs } });
  await userModel.deleteOne({ _id: user._id });

  const leftoverOrders = await orderModel.countDocuments({ _id: { $in: allOrderIds } });
  const leftoverBatches = await paymentBatchModel.countDocuments({ batchRef: { $in: createdBatchRefs } });
  check("teardown removed all test data", leftoverOrders === 0 && leftoverBatches === 0);

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("FAILED:");
    failed.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
  }
  console.log("=".repeat(72));

  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
  console.error("\nVerification crashed:", error);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
