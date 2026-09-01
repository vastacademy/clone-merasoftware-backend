// Order lifecycle guards — the rules about which visibility transitions are legal.
//
// A cancelled order is terminal: its money has been settled and refunded, and there is
// deliberately no un-cancel action. But four separate code paths flip an order back to
// "approved" whenever money settles against it, and none of them knew cancellation existed:
//
//   controller/user/walletPayInstant.js            (installment settle, and full settle)
//   controller/user/transactionApprovalController  (admin approves a still-pending payment)
//   helpers/serviceCycleSettlement.js              (a service's first cycle settles)
//
// Any of those would silently resurrect a cancelled project — an un-cancel through the back
// door. This helper is the single place that decides, so the rule cannot drift apart again.

const TERMINAL_VISIBILITIES = new Set(["cancelled"]);

// Can this order still be moved to `approved` by a payment settling against it?
const canApproveOrder = (order) => !TERMINAL_VISIBILITIES.has(order?.orderVisibility);

// Apply the "money settled, so this order is approved" transition — but only when the order
// is not in a terminal state. Callers keep their own surrounding logic (installment pointers,
// paidAmount, status); this owns only the visibility decision.
const markOrderApproved = (order) => {
  if (!canApproveOrder(order)) return false;
  order.orderVisibility = "approved";
  if (order.status === "pending") order.status = "in_progress";
  return true;
};

// Is this order closed to new money and new work? Used by payment surfaces to refuse
// starting a payment against something that has already been settled and refunded.
const isOrderCancelled = (order) => order?.orderVisibility === "cancelled";

module.exports = {
  canApproveOrder,
  markOrderApproved,
  isOrderCancelled,
};
