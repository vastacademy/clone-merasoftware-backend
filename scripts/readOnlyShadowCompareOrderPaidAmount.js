// READ-ONLY shadow comparison. Writes nothing.
//
// Question it answers, with data instead of reasoning:
//   If every payment path SET paidAmount/remainingAmount through setOrderPaidAmount()
//   (helpers/orderPaymentTotals.js) instead of maintaining them by hand, would any order's
//   numbers come out different from what is stored today?
//
// This is the gate before any call site is rewritten. The helper replaces hand-written `+=` /
// `-=` / clamp arithmetic spread across the payment paths; that swap is only safe if the helper
// already reproduces the stored answer everywhere it would run. Any order it disagrees on is
// information that must be understood BEFORE the swap, not a number to be overwritten after it.
//
// The same shadow-first approach scripts/readOnlyShadowCompareStatusEngine.js used for the status
// engine: run the new rule beside the old one on live data, prove they agree, then switch.
//
// HOW IT STAYS READ-ONLY
// The helper mutates the order it is handed, so every order is deep-copied first and the helper
// runs against the copy. The real documents are loaded .lean() and never saved.
//
// Run:  node scripts/readOnlyShadowCompareOrderPaidAmount.js
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const {
  setOrderPaidAmount,
  canDeriveOrderPaidAmount,
  externalRefundTotal,
} = require("../helpers/orderPaymentTotals");
require("../models/productModel"); // register 'product' so populate('productId') works

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

let passed = 0;
let failed = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  line("  " + (ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "   got " + JSON.stringify(actual)));
  ok ? passed++ : failed++;
};

const main = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_URL;
  if (!uri) {
    line("No Mongo URI found in .env (looked for MONGODB_URI / MONGO_URI / MONGODB_URL).");
    process.exit(1);
  }
  const host = (uri.match(/@([^/?]+)/) || [])[1] || "(unknown host)";
  line("target database host : " + host);
  line("MODE: READ-ONLY (nothing is written)");
  await mongoose.connect(uri);

  // ── 1. the rules the helper encodes, on cases chosen to break it ──
  sep();
  line("RULES THE HELPER MUST HOLD");
  check("a service order is refused (its paidAmount means a billing cycle, not the order)",
    canDeriveOrderPaidAmount({ isServicePlan: true }), false);
  check("a project order is accepted", canDeriveOrderPaidAmount({ isServicePlan: false }), true);
  check("a missing order is refused", canDeriveOrderPaidAmount(null), false);
  check("a wallet refund leg is NOT subtracted (it already has a transaction)",
    externalRefundTotal({ refunds: [{ method: "wallet", amount: 4500 }] }), 0);
  check("an external refund leg IS subtracted (it has no transaction)",
    externalRefundTotal({ refunds: [{ method: "wallet", amount: 4500 }, { method: "upi", amount: 630 }] }), 630);
  check("no refunds at all subtracts nothing", externalRefundTotal({}), 0);

  // ── 2. the helper against every live order ──
  const orders = await orderProductModel
    .find({})
    .select("paidAmount remainingAmount totalAmount totalPrice price isServicePlan refunds refundTotal projectSnapshot servicePlanSnapshot productId isPartialPayment installments status orderVisibility")
    .populate("productId", "serviceName")
    .lean();

  const nameOf = (o) =>
    o.projectSnapshot?.displayName || o.productId?.serviceName || o.servicePlanSnapshot?.serviceName || "(unnamed)";

  const agree = [];
  const differ = [];
  const refused = [];

  for (const order of orders) {
    if (!canDeriveOrderPaidAmount(order)) {
      refused.push({ order, name: nameOf(order) });
      continue;
    }
    // Deep copy: the helper assigns onto what it is given, and the real document must not change.
    const candidate = JSON.parse(JSON.stringify(order));
    candidate._id = order._id;
    await setOrderPaidAmount(candidate);

    const row = {
      order,
      name: nameOf(order),
      storedPaid: money(order.paidAmount),
      storedRemaining: money(order.remainingAmount),
      helperPaid: money(candidate.paidAmount),
      helperRemaining: money(candidate.remainingAmount),
    };
    const same = row.storedPaid === row.helperPaid && row.storedRemaining === row.helperRemaining;
    (same ? agree : differ).push(row);
  }

  sep();
  line("SERVICE ORDERS THE HELPER REFUSES — these keep their own writer and must stay untouched");
  refused.forEach((r) =>
    line("  " + r.name + "   stored paidAmount " + money(r.order.paidAmount)));

  sep();
  line("PROJECT ORDERS WHERE THE HELPER DISAGREES WITH STORED : " + differ.length);
  if (!differ.length) line("  (none — the helper reproduces every stored figure)");
  differ.forEach((r) => {
    line("");
    line("  ORDER " + r.order._id + "   " + r.name);
    line("    status/visibility : " + r.order.status + " / " + r.order.orderVisibility);
    line("    paidAmount        : stored " + r.storedPaid + "   ->  helper " + r.helperPaid +
         (r.storedPaid === r.helperPaid ? "   (same)" : "   <-- DIFFERS"));
    line("    remainingAmount   : stored " + r.storedRemaining + "   ->  helper " + r.helperRemaining +
         (r.storedRemaining === r.helperRemaining ? "   (same)" : "   <-- DIFFERS"));
  });

  sep();
  line("");
  line("SUMMARY");
  line("  orders scanned                 : " + orders.length);
  line("  service orders refused         : " + refused.length);
  line("  project orders in agreement    : " + agree.length);
  line("  project orders in disagreement : " + differ.length);
  line("  rule checks                    : " + passed + " passed, " + failed + " failed");
  line("");
  line(differ.length === 0 && failed === 0
    ? "The helper reproduces stored reality everywhere it would run. Rewriting the call sites to "
      + "use it changes no order's numbers."
    : "Disagreements above must be understood BEFORE any call site is rewritten. Each one is "
      + "either a bug in the helper or drift already sitting in the data — decide which, per order.");
  line("(nothing was modified)");

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Shadow compare failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
