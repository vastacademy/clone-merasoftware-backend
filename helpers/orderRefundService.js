const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
const orderProductModel = require("../models/orderProductModel");
const { refundWalletInstant } = require("./transactionService");
const { reverseProjectInvoicePayment } = require("./paymentRecording");
const { syncProjectFinalInvoice } = require("./projectFinalInvoice");
const { syncServiceBillingStatement } = require("./serviceBillingStatement");

// Refund SSOT for a cancelled order.
//
// The rule is "refund to source": money goes back the way it came in. An order's payment legs
// are already stored as separate transactions, each with its own paymentMethod and amount
// (see customerCreateCustomProjectOrder.js's wallet/UPI split), so the split never has to be
// remembered by an admin — it is derived from what was actually received.
//
// Two kinds of leg, and they are NOT the same kind of action:
//   - wallet  -> this system holds the money, so the server credits it back instantly.
//   - anything else -> the money left through a bank/UPI rail the server cannot reach. The
//     admin sends it by hand and records their own reference id, which is what the customer
//     is told so they can look the payment up on their side.

const getOrderTotal = (order) =>
  Number(order?.totalAmount || order?.totalPrice || order?.price || 0);

// What this order actually received, grouped by the method it came in through. Mirrors
// orderPaymentTotals.js's counting rules exactly — only 'completed' money counts, a
// 'refund' subtracts, and 'deposit'/'renewal' never belong to this order's own price.
const buildRefundBreakdown = async (orderId) => {
  const transactions = await transactionModel
    .find({ orderId })
    .select("amount status type paymentMethod invoiceId transactionId")
    .lean();

  const byMethod = new Map();
  let alreadyRefunded = 0;

  for (const txn of transactions) {
    if (txn.status !== "completed") continue;
    const amount = Number(txn.amount || 0);
    if (!(amount > 0)) continue;

    if (txn.type === "refund") {
      alreadyRefunded += amount;
      continue;
    }
    if (txn.type !== "payment") continue;

    const method = txn.paymentMethod || "upi";
    byMethod.set(method, Number(byMethod.get(method) || 0) + amount);
  }

  const legs = [...byMethod.entries()]
    .map(([method, amount]) => ({ method, amount }))
    .sort((a, b) => b.amount - a.amount);

  const totalPaid = legs.reduce((sum, leg) => sum + leg.amount, 0);

  return {
    legs,
    totalPaid,
    alreadyRefunded,
    refundable: Math.max(0, totalPaid - alreadyRefunded),
    // External legs need a reference id from the admin; wallet legs do not.
    requiresReference: legs.some((leg) => leg.method !== "wallet"),
  };
};

// Undo the financial state this order's payments had advanced, then hand the money back.
//
// Order matters and is the same as the existing rejection path in transactionApprovalController.js:
// the invoice/order rollback runs BEFORE the wallet credit, so a customer can never hold refunded
// money while the invoice still reads as paid.
const reverseOrderSettlement = async (order, amount) => {
  if (!(Number(amount) > 0)) return;

  // Invoices are settled per-invoice, so each one is reversed against its own linked money.
  // reverseProjectInvoicePayment re-derives from the invoice's remaining completed
  // transactions rather than subtracting a passed figure, which makes this idempotent.
  const invoices = await invoiceModel.find({ orderId: order._id });
  for (const invoice of invoices) {
    if (Number(invoice.amountPaid || 0) > 0) {
      await reverseProjectInvoicePayment({ invoice, amount: Number(invoice.amountPaid || 0) });
    }
  }

  const orderTotal = getOrderTotal(order);
  order.paidAmount = Math.max(0, Number(order.paidAmount || 0) - Number(amount));
  order.remainingAmount = Math.max(0, orderTotal - Number(order.paidAmount || 0));
  order.paymentComplete = false;
  await order.save();

  if (order.isServicePlan) {
    await syncServiceBillingStatement(order);
  } else {
    await syncProjectFinalInvoice(order);
  }
};

// Refund every leg of one order. `referenceIds` maps a non-wallet method to the reference the
// admin got when they sent that money by hand — required for those legs, ignored for wallet.
const refundOrderToSource = async ({ order, actorId, referenceIds = {} }) => {
  const breakdown = await buildRefundBreakdown(order._id);

  if (!(breakdown.refundable > 0)) {
    return { refunds: [], refundTotal: 0, breakdown };
  }

  // Every external leg must carry a reference before any money moves — a half-refunded order
  // is worse than one that was refused outright.
  for (const leg of breakdown.legs) {
    if (leg.method === "wallet") continue;
    if (!String(referenceIds[leg.method] || "").trim()) {
      throw new Error(`A reference id is required for the ${leg.method} refund`);
    }
  }

  await reverseOrderSettlement(order, breakdown.refundable);

  const refunds = [];
  for (const leg of breakdown.legs) {
    if (leg.method === "wallet") {
      // Idempotent on transactionId, so a retried cancel never credits the wallet twice.
      const transaction = await refundWalletInstant({
        userId: order.userId,
        transactionId: `REFUND-${order._id}-WALLET`,
        amount: leg.amount,
        description: `Refund for cancelled order ${order._id}`,
        orderId: order._id,
      });
      refunds.push({
        method: "wallet",
        amount: leg.amount,
        transactionId: transaction.transactionId,
        referenceId: null,
        refundedAt: new Date(),
      });
      continue;
    }

    // Money the admin already sent outside this system. Recorded, not moved.
    refunds.push({
      method: leg.method,
      amount: leg.amount,
      transactionId: null,
      referenceId: String(referenceIds[leg.method]).trim(),
      refundedAt: new Date(),
    });
  }

  const refundTotal = refunds.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);

  await orderProductModel.updateOne(
    { _id: order._id },
    { $set: { refunds, refundTotal } }
  );

  return { refunds, refundTotal, breakdown };
};

module.exports = {
  buildRefundBreakdown,
  refundOrderToSource,
};
