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

// How much of what was paid is actually owed back, and why.
//
// The rule the owner set: a refund is what has NOT been used up.
//   - Project: no work started (0% progress) -> the whole amount is owed back. Once any node
//     update exists, progress is only a SUGGESTION — the admin decides the real figure, because
//     40% progress does not reliably mean 40% of the cost was spent.
//   - Service: billing is time-based, so the unused part of the running cycle is owed back
//     pro-rata by days. Cycles already completed were used and are not refundable.
//
// Returns the suggestion plus the numbers it came from, so the admin sees the working — an
// unexplained figure gets overridden every time, which defeats the point of calculating it.
const buildRefundSuggestion = (order, refundable) => {
  const cap = Math.max(0, Number(refundable) || 0);

  if (order?.isServicePlan) {
    const start = order.serviceCurrentCycleStart ? new Date(order.serviceCurrentCycleStart) : null;
    const end = order.serviceCurrentCycleEnd ? new Date(order.serviceCurrentCycleEnd) : null;
    const cyclePrice = Number(order.serviceCyclePrice || 0);

    // Without a real cycle window or price there is nothing to pro-rate against; fall back to
    // the full refundable amount rather than inventing a number.
    if (!start || !end || !(cyclePrice > 0) || !(end > start)) {
      return {
        basis: "service_no_cycle",
        suggested: cap,
        explanation: "No billing cycle information — full refund suggested.",
      };
    }

    const DAY = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end - start) / DAY));
    const now = new Date();
    const usedDays = Math.min(totalDays, Math.max(0, Math.round((now - start) / DAY)));
    const unusedDays = Math.max(0, totalDays - usedDays);

    // Only the running cycle is refundable — completed cycles were delivered.
    const suggested = Math.min(cap, Math.round((cyclePrice * unusedDays) / totalDays));

    return {
      basis: "service_prorata",
      suggested,
      totalDays,
      usedDays,
      unusedDays,
      cyclePrice,
      completedCycles: Number(order.serviceCompletedCycles || 0),
      explanation: `${usedDays} of ${totalDays} days used, ${unusedDays} unused — pro-rata of the current cycle.`,
    };
  }

  const progress = Math.round(Number(order?.projectProgress || 0));

  if (progress <= 0) {
    return {
      basis: "project_not_started",
      suggested: cap,
      progress: 0,
      explanation: "Work has not started — the full amount is refundable.",
    };
  }

  // Progress-based figure is a starting point only; the admin is expected to judge it.
  return {
    basis: "project_in_progress",
    suggested: Math.min(cap, Math.round((cap * (100 - progress)) / 100)),
    progress,
    adminDecides: true,
    explanation: `${progress}% of the work is done — suggested figure is the remaining ${100 - progress}%. Adjust it to what was actually spent.`,
  };
};

// How the refund is divided across the methods it came in through.
//
// Three modes, because "refund to source" is right almost always but not quite always:
//
//   source       (default) — same proportion the money arrived in. The honest default: money
//                goes back the way it came, so nothing is trapped anywhere it did not start.
//   wallet_first — fill the wallet leg first, then the rest. Use ONLY when the customer asked
//                for it: it converts their bank money into wallet credit they can no longer
//                withdraw, which is a real loss to them if they did not choose it.
//   manual       — the admin sets each leg. Still bounded by the same rule below.
//
// One rule holds in every mode: a leg can never receive more than it originally paid. Sending
// wallet money out to a bank, or bank money beyond what that bank sent, is not a refund.
const buildPayoutLegs = ({ legs, refundable, requested, mode = "source", manualLegs = null }) => {
  const byMethod = new Map(legs.map((leg) => [leg.method, Number(leg.amount || 0)]));

  const guard = (payouts) => {
    for (const leg of payouts) {
      const original = Number(byMethod.get(leg.method) || 0);
      if (leg.amount > original) {
        throw new Error(
          `The ${leg.method} refund cannot exceed the ${original} originally paid by that method`
        );
      }
    }
    const total = payouts.reduce((sum, leg) => sum + leg.amount, 0);
    if (total !== requested) {
      throw new Error(`Refund parts must add up to ${requested} (they add up to ${total})`);
    }
    return payouts.filter((leg) => leg.amount > 0);
  };

  if (mode === "manual") {
    if (!manualLegs || typeof manualLegs !== "object") {
      throw new Error("Manual refund requires an amount for each method");
    }
    const payouts = legs.map((leg) => ({
      method: leg.method,
      amount: Math.round(Number(manualLegs[leg.method] || 0)),
    }));
    for (const leg of payouts) {
      if (!Number.isFinite(leg.amount) || leg.amount < 0) {
        throw new Error(`The ${leg.method} refund must be zero or more`);
      }
    }
    return guard(payouts);
  }

  if (mode === "wallet_first") {
    // Wallet absorbs as much as it originally paid; whatever is left follows source order.
    let left = requested;
    const walletCap = Number(byMethod.get("wallet") || 0);
    const walletShare = Math.min(walletCap, left);
    left -= walletShare;

    const payouts = [{ method: "wallet", amount: walletShare }];
    for (const leg of legs) {
      if (leg.method === "wallet") continue;
      const share = Math.min(Number(leg.amount || 0), left);
      left -= share;
      payouts.push({ method: leg.method, amount: share });
    }
    return guard(payouts);
  }

  // source (default) — same proportion the money arrived in. The last leg absorbs the rounding
  // remainder so the parts always sum to exactly `requested`.
  let allocated = 0;
  const payouts = legs.map((leg, index) => {
    const isLast = index === legs.length - 1;
    const share = isLast
      ? requested - allocated
      : Math.round((requested * Number(leg.amount || 0)) / refundable);
    allocated += share;
    return { method: leg.method, amount: share };
  });
  return guard(payouts);
};

// Undo the financial state this order's payments had advanced, then hand the money back.
//
// Order matters and is the same as the existing rejection path in transactionApprovalController.js:
// the invoice/order rollback runs BEFORE the wallet credit, so a customer can never hold refunded
// money while the invoice still reads as paid.
const reverseOrderSettlement = async (order, amount) => {
  if (!(Number(amount) > 0)) return;

  // Reverse only what is actually being refunded, spread across the order's invoices.
  //
  // A partial refund made this subtle: the refund transaction carries no invoiceId (see
  // refundWalletInstant), so an invoice's derived total never sees it — which is why the
  // reversal must state the figure itself. Reversing each invoice's whole amountPaid, as the
  // full-refund-only version did, would wipe an invoice the customer only got half back on.
  //
  // Oldest invoice first, so a part-refunded order keeps its earliest invoices settled and
  // shows the shortfall on the most recent one.
  let remaining = Number(amount);
  const invoices = await invoiceModel.find({ orderId: order._id }).sort({ invoiceDate: 1, createdAt: 1 });
  for (const invoice of invoices) {
    if (remaining <= 0) break;
    const paid = Number(invoice.amountPaid || 0);
    if (!(paid > 0)) continue;
    const take = Math.min(paid, remaining);
    await reverseProjectInvoicePayment({ invoice, amount: take });
    remaining -= take;
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
const refundOrderToSource = async ({
  order,
  actorId,
  referenceIds = {},
  refundAmount = null,
  refundMode = "source",
  manualLegs = null,
  refundReason = null,
}) => {
  const breakdown = await buildRefundBreakdown(order._id);

  if (!(breakdown.refundable > 0)) {
    return { refunds: [], refundTotal: 0, breakdown, suggestion: null };
  }

  const suggestion = buildRefundSuggestion(order, breakdown.refundable);

  // The admin's figure wins when given; otherwise the calculated one stands. Either way it can
  // never exceed what was actually received — refunding more than was paid is not a refund.
  const requested = refundAmount === null || refundAmount === undefined
    ? suggestion.suggested
    : Number(refundAmount);

  if (!Number.isFinite(requested) || requested < 0) {
    throw new Error("A valid refund amount is required");
  }
  if (requested > breakdown.refundable) {
    throw new Error(
      `Refund cannot exceed the amount received (${breakdown.refundable})`
    );
  }
  if (!(requested > 0)) {
    return { refunds: [], refundTotal: 0, breakdown, suggestion };
  }

  const payoutLegs = buildPayoutLegs({
    legs: breakdown.legs,
    refundable: breakdown.refundable,
    requested,
    mode: refundMode,
    manualLegs,
  });

  // Putting MORE into the wallet than the source split would is the one direction that costs the
  // customer something: their bank money becomes wallet credit they can only spend here. That is
  // legitimate when they asked for it, so it is allowed — but it must be on the record why.
  const sourceLegs = buildPayoutLegs({
    legs: breakdown.legs,
    refundable: breakdown.refundable,
    requested,
    mode: "source",
  });
  const walletIn = (list) => Number(list.find((leg) => leg.method === "wallet")?.amount || 0);
  const walletExcess = walletIn(payoutLegs) - walletIn(sourceLegs);
  if (walletExcess > 0 && !String(refundReason || "").trim()) {
    throw new Error(
      "Sending more to the wallet than was paid from it needs a reason — the customer must have asked for it"
    );
  }

  // Every external leg must carry a reference before any money moves — a half-refunded order
  // is worse than one that was refused outright. Only legs actually being paid out need one.
  for (const leg of payoutLegs) {
    if (leg.method === "wallet") continue;
    if (!String(referenceIds[leg.method] || "").trim()) {
      throw new Error(`A reference id is required for the ${leg.method} refund`);
    }
  }

  await reverseOrderSettlement(order, requested);

  const refunds = [];
  for (const leg of payoutLegs) {
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
    {
      $set: {
        refunds,
        refundTotal,
        // Kept so a later reader can see the figure was deliberate, not arbitrary.
        refundSuggestedAmount: suggestion.suggested,
        refundBasis: suggestion.basis,
        refundExplanation: suggestion.explanation,
        refundMode,
        refundModeReason: String(refundReason || "").trim() || null,
      },
    }
  );

  return { refunds, refundTotal, breakdown, suggestion };
};

module.exports = {
  buildRefundBreakdown,
  buildRefundSuggestion,
  buildPayoutLegs,
  refundOrderToSource,
};
