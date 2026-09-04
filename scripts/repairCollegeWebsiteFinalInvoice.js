// Creates the missing project_final invoice for order 67ca900eb74653ac7d14d96a
// (College Website, SLN College <slnaycollege@gmail.com>).
//
// WHY IT IS MISSING
// project_final is the cumulative payment summary every project order carries; the admin
// workspace's invoice Download/Share control renders only when one exists
// (AdminClientWorkspace.js looks for invoiceType === "project_final"), which is why this order
// shows no download option. syncProjectFinalInvoice() writes it after each successful payment,
// but this order predates that flow and never had a payment processed through it — its money was
// only recorded now, by scripts/repairMissingCollegeWebsitePayment.js.
//
// scripts/backfillProjectFinalInvoices.js exists for exactly this class of order, but it sweeps
// every paid project (24 of them, 17 of which already have their final invoice and would be
// rewritten). This script does the same work for the ONE order that needs it, so nothing else is
// touched.
//
// HOW
// Through syncProjectFinalInvoice() (helpers/projectFinalInvoice.js) — the same helper the live
// payment paths call. It derives amount, amountPaid and status from the order itself, so this
// script states no money of its own. It is also idempotent by construction: given an existing
// invoice it updates in place rather than creating a second one.
//
// DRY-RUN BY DEFAULT. Pass --apply to write.
//   node scripts/repairCollegeWebsiteFinalInvoice.js
//   node scripts/repairCollegeWebsiteFinalInvoice.js --apply
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const orderProductModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const { syncProjectFinalInvoice } = require("../helpers/projectFinalInvoice");
require("../models/userModel");    // register 'user' for populate
require("../models/productModel"); // register 'product' for populate

const ORDER_ID = "67ca900eb74653ac7d14d96a";
const CUSTOMER_EMAIL = "slnaycollege@gmail.com";
const EXPECTED_TOTAL = 30000;

const APPLY = process.argv.includes("--apply");
const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(78));
const money = (v) => Number(Number(v || 0).toFixed(2));

let failed = 0;
const guard = (label, ok, detail) => {
  line("  " + (ok ? "OK  " : "FAIL") + "  " + label + (detail ? "   " + detail : ""));
  if (!ok) failed++;
  return ok;
};

const finish = async () => {
  await mongoose.disconnect();
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
  line(APPLY ? "MODE: APPLY (will write)" : "MODE: DRY-RUN (no writes)");
  line("scope: one project_final invoice for one order");
  line("");

  sep();
  line("PRECONDITIONS — every one must hold before anything is written");

  const order = await orderProductModel.findById(ORDER_ID).populate("userId", "email name");
  if (!guard("order exists", Boolean(order), ORDER_ID)) return finish();

  guard("order belongs to " + CUSTOMER_EMAIL,
    order.userId?.email === CUSTOMER_EMAIL, "found " + (order.userId?.email || "-"));
  // syncProjectFinalInvoice() returns null for anything that is not a website project.
  guard("order is a website project", order.isWebsiteProject === true);
  guard("order total is " + EXPECTED_TOTAL,
    Math.abs(money(order.totalAmount || order.price) - EXPECTED_TOTAL) < 0.01,
    "found " + money(order.totalAmount || order.price));
  guard("order is fully paid (paidAmount " + EXPECTED_TOTAL + ")",
    Math.abs(money(order.paidAmount) - EXPECTED_TOTAL) < 0.01, "found " + money(order.paidAmount));
  guard("no money outstanding", money(order.remainingAmount) === 0,
    "found " + money(order.remainingAmount));

  const existing = await invoiceModel.findOne({ orderId: order._id, invoiceType: "project_final" });
  guard("no project_final invoice exists yet (the gap this fills)",
    !existing, existing ? "found " + existing.invoiceNumber : "");

  const others = await invoiceModel.countDocuments({ orderId: order._id });
  line("  --    other invoices on this order : " + others + " (untouched)");

  line("");
  if (failed > 0) {
    sep();
    line(failed + " precondition(s) failed — nothing was written.");
    line("The record is not in the state this repair was written for. Re-check before forcing it.");
    return finish();
  }

  sep();
  line("PLANNED WRITE");
  line("  project_final invoice : amount " + EXPECTED_TOTAL + ", amountPaid " + EXPECTED_TOTAL +
       ", status paid");
  line("  derived by            : helpers/projectFinalInvoice.js from the order's own fields");
  line("  effect                : the admin workspace's invoice Download/Share control appears");
  line("");

  if (!APPLY) {
    sep();
    line("DRY-RUN complete — nothing was written. Re-run with --apply to write.");
    return finish();
  }

  const invoice = await syncProjectFinalInvoice(order);

  sep();
  line("RESULT");
  if (!invoice) {
    line("  helper returned null — nothing was created. Check isWebsiteProject on the order.");
    return finish();
  }
  line("  invoiceNumber : " + invoice.invoiceNumber);
  line("  invoiceType   : " + invoice.invoiceType);
  line("  amount        : " + money(invoice.amount) + "   amountPaid " + money(invoice.amountPaid));
  line("  status        : " + invoice.status);
  line("");
  line("APPLIED. Reload the client's payment record in the admin workspace — the invoice "
     + "Download/Share control should now be present.");
  return finish();
};

main().catch(async (error) => {
  console.error("Repair failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
