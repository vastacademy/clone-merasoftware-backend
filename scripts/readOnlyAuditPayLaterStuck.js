/**
 * READ-ONLY — no writes anywhere. Diagnoses why a "pay later" (decide_later) project
 * stays stuck showing "Payment Pending" even AFTER the customer paid by UPI and the
 * admin approved that payment.
 *
 * It evaluates the exact same expressions the live code uses, so the output is evidence,
 * not interpretation:
 *   - getOrderDetails.js:91  -> the badge query (hasUnpaidInvoice / unpaidInvoice)
 *   - ProjectDetails.js:582  -> isOrderPendingApproval
 *   - ProjectDetails.js:583  -> isUploadLocked
 *
 * The key question it answers: WHICH invoice does the badge query pick — the real
 * `project` bill, or the `project_final` cumulative statement (which is a statement,
 * not a payment request — see helpers/projectFinalInvoice.js) — and did the customer's
 * approved payment actually land on the invoice the badge is reading?
 *
 * Usage:
 *   node scripts/readOnlyAuditPayLaterStuck.js <orderId>     # one specific order
 *   node scripts/readOnlyAuditPayLaterStuck.js               # scan recent stuck ones
 */
require("dotenv").config();
const mongoose = require("mongoose");
const orderModel = require("../models/orderProductModel");
require("../models/productModel"); // registers 'product' for populate
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");

const orderIdArg = process.argv[2];

const money = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN")}`;

const auditOrder = async (order) => {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`ORDER ${order._id}`);
  console.log("=".repeat(78));
  console.log(`  product         : ${order.productId?.serviceName || "-"}`);
  console.log(`  createdAt       : ${order.createdAt}`);
  console.log(`  orderVisibility : ${order.orderVisibility}`);
  console.log(`  status          : ${order.status}`);
  console.log(`  isPartialPayment: ${order.isPartialPayment}`);
  console.log(`  totalAmount     : ${money(order.totalAmount)}`);
  console.log(`  paidAmount      : ${money(order.paidAmount)}`);
  console.log(`  remainingAmount : ${money(order.remainingAmount)}`);
  console.log(`  paymentComplete : ${order.paymentComplete}`);

  if (Array.isArray(order.installments) && order.installments.length) {
    console.log(`\n  -- installments --`);
    order.installments.forEach((i) => {
      console.log(
        `     #${i.installmentNumber} | ${money(i.amount)} | paid=${i.paid}` +
          ` | paymentStatus=${i.paymentStatus} | threshold=${i.progressThreshold ?? "null"}`
      );
    });
  }

  // ---------------- ALL invoices on this order ----------------
  const invoices = await invoiceModel
    .find({ orderId: order._id })
    .select("invoiceNumber invoiceType amount amountPaid status installmentNumber invoiceDate paymentMethod")
    .sort({ invoiceDate: 1 })
    .lean();

  console.log(`\n  -- ALL INVOICES (${invoices.length}) --`);
  invoices.forEach((inv) => {
    console.log(
      `     ${inv.invoiceNumber} | type=${inv.invoiceType} | status=${inv.status}` +
        ` | amount=${money(inv.amount)} | amountPaid=${money(inv.amountPaid)}` +
        (inv.installmentNumber ? ` | inst#${inv.installmentNumber}` : "") +
        ` | method=${inv.paymentMethod || "-"}`
    );
  });

  // ---------------- The badge query, verbatim from getOrderDetails.js:91 ----------------
  // NOTE: reproduced EXACTLY as the live code runs it — including the absence of any
  // invoiceType filter, which is the thing under investigation.
  const earliestUnpaidInvoice = await invoiceModel
    .findOne({ orderId: order._id, status: { $in: ["unpaid", "overdue"] } })
    .sort({ installmentNumber: 1, invoiceDate: 1 })
    .select("amount status invoiceNumber installmentNumber invoiceType")
    .lean();

  console.log(`\n  -- BADGE QUERY (getOrderDetails.js:91, run verbatim) --`);
  console.log(`     hasUnpaidInvoice : ${Boolean(earliestUnpaidInvoice)}`);
  if (earliestUnpaidInvoice) {
    console.log(
      `     picked invoice   : ${earliestUnpaidInvoice.invoiceNumber}` +
        ` | type=${earliestUnpaidInvoice.invoiceType}` +
        ` | status=${earliestUnpaidInvoice.status}` +
        ` | amount=${money(earliestUnpaidInvoice.amount)}`
    );
    if (earliestUnpaidInvoice.invoiceType === "project_final") {
      console.log(
        `     >>> The badge is reading the CUMULATIVE STATEMENT (project_final),`
      );
      console.log(
        `     >>> not a real payment request. projectFinalInvoice.js calls it`
      );
      console.log(`     >>> "a statement, not another amount to collect".`);
    }
  }

  // ---------------- Transactions ----------------
  const txns = await transactionModel
    .find({ orderId: order._id })
    .select("transactionId upiTransactionId amount status paymentStatus paymentMethod sourceType invoiceId installmentNumber createdAt")
    .sort({ createdAt: 1 })
    .lean();

  console.log(`\n  -- TRANSACTIONS (${txns.length}) --`);
  if (!txns.length) console.log(`     (none)`);
  txns.forEach((t) => {
    const target = t.invoiceId
      ? invoices.find((i) => String(i._id) === String(t.invoiceId))
      : null;
    console.log(
      `     ${t.transactionId} | ${t.paymentMethod} | ${money(t.amount)}` +
        ` | status=${t.status} | sourceType=${t.sourceType || "-"}` +
        (t.installmentNumber ? ` | inst#${t.installmentNumber}` : "")
    );
    console.log(
      `        -> invoiceId=${t.invoiceId || "NULL"}` +
        (target ? `  (${target.invoiceNumber}, type=${target.invoiceType})` : t.invoiceId ? "  (not found)" : "")
    );
  });

  // ---------------- The actual diagnosis ----------------
  const realBills = invoices.filter((i) => i.invoiceType === "project");
  const statement = invoices.find((i) => i.invoiceType === "project_final");
  const unpaidRealBills = realBills.filter((i) =>
    ["unpaid", "overdue", "partially_paid"].includes(i.status)
  );
  const completedTxns = txns.filter((t) => t.status === "completed");
  const totalCompleted = completedTxns.reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const paymentsOnStatement = completedTxns.filter(
    (t) => statement && String(t.invoiceId) === String(statement._id)
  );

  console.log(`\n  -- DIAGNOSIS --`);
  console.log(`     real 'project' bills      : ${realBills.length} (unpaid/partial: ${unpaidRealBills.length})`);
  console.log(`     'project_final' statement : ${statement ? `${statement.invoiceNumber} (status=${statement.status})` : "none"}`);
  console.log(`     completed payments        : ${completedTxns.length} totalling ${money(totalCompleted)}`);
  console.log(`     payments aimed at the statement instead of a real bill: ${paymentsOnStatement.length}`);

  const stuck =
    order.orderVisibility === "pending-approval" && totalCompleted > 0;

  if (paymentsOnStatement.length > 0) {
    console.log(`\n     *** MISDIRECTED PAYMENT ***`);
    console.log(`     The customer's money settled the project_final STATEMENT.`);
    console.log(`     The real 'project' bill was never settled, so the badge`);
    console.log(`     query keeps finding it unpaid and the banner never clears.`);
  }

  if (stuck) {
    console.log(`\n     *** STUCK ORDER ***`);
    console.log(`     ${money(totalCompleted)} of completed payment exists, but`);
    console.log(`     orderVisibility is still 'pending-approval'.`);
  }

  // Frontend gates, verbatim
  const isOrderPendingApproval = order.orderVisibility === "pending-approval";
  const isUploadLocked = Boolean(earliestUnpaidInvoice) || isOrderPendingApproval;
  console.log(`\n  -- WHAT THE CUSTOMER SEES (ProjectDetails.js) --`);
  console.log(`     isOrderPendingApproval : ${isOrderPendingApproval}`);
  console.log(`     hasUnpaidInvoice       : ${Boolean(earliestUnpaidInvoice)}`);
  console.log(`     isUploadLocked         : ${isUploadLocked}`);
  console.log(
    `     banner shown           : ${
      isOrderPendingApproval
        ? "'Payment Submitted - Awaiting Approval' (emerald)"
        : earliestUnpaidInvoice
        ? "'Payment Pending' (amber)"
        : "none"
    }`
  );
};

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  if (orderIdArg) {
    const order = await orderModel
      .findById(orderIdArg)
      .populate("productId", "serviceName category")
      .lean();
    if (!order) {
      console.log("Order not found");
    } else {
      await auditOrder(order);
    }
  } else {
    // Scan: website projects still pending-approval, newest first.
    const candidates = await orderModel
      .find({ isWebsiteProject: true, orderVisibility: "pending-approval" })
      .populate("productId", "serviceName category")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`\nFound ${candidates.length} website project(s) in 'pending-approval'.`);
    for (const order of candidates) {
      await auditOrder(order);
    }
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log("READ-ONLY audit complete. Nothing was written.");
  console.log("=".repeat(78));

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error("Audit failed:", error.message);
  try {
    await mongoose.disconnect();
  } catch (e) {}
  process.exit(1);
});
