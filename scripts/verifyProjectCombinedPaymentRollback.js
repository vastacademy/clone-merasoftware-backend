/**
 * Regression check: a rejected combined project payment must reverse the
 * instant wallet portion everywhere it was recorded (order, invoice and final
 * project statement), then refund the wallet. All fixtures are removed.
 *
 * Usage: node scripts/verifyProjectCombinedPaymentRollback.js
 */
require("dotenv").config();
const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const orderModel = require("../models/orderProductModel");
const invoiceModel = require("../models/invoiceModel");
const transactionModel = require("../models/transactionModel");
const { createProjectInvoice, markProjectInvoicePaid } = require("../helpers/paymentRecording");
const { syncProjectFinalInvoice } = require("../helpers/projectFinalInvoice");
const { deductWalletInstant, createPaymentTransaction } = require("../helpers/transactionService");
const { approveTransaction, rejectTransaction } = require("../controller/user/transactionApprovalController");

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const mockRes = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; },
});

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const amount = 1000;
  const walletPart = 400;
  const parentId = `ZZPRJ${Date.now()}`;
  let user;
  let order;

  try {
    user = await userModel.create({
      name: "ZZ Project Rollback Test",
      email: `zz-project-rollback-${Date.now()}@example.invalid`,
      password: "x",
      roles: ["customer"],
      walletBalance: walletPart,
    });
    order = await orderModel.create({
      userId: user._id,
      quantity: 1,
      price: amount,
      totalAmount: amount,
      paidAmount: 0,
      remainingAmount: amount,
      isWebsiteProject: true,
      orderVisibility: "pending-approval",
      projectSnapshot: { displayName: "ZZ Project Rollback" },
      orderItems: [{ name: "ZZ Project Rollback", finalPrice: amount, originalPrice: amount }],
    });
    const invoice = await createProjectInvoice({
      customerId: user._id,
      orderId: order._id,
      amount,
      lineItems: [{ name: "ZZ Project Rollback", price: amount }],
    });
    const walletTxn = await deductWalletInstant({
      userId: user._id,
      transactionId: `${parentId}-W`,
      amount: walletPart,
      orderId: order._id,
      parentTransactionId: parentId,
      sourceType: "invoice",
      description: "ZZ project combined wallet portion",
    });
    await markProjectInvoicePaid({
      invoice,
      customerId: user._id,
      paymentMethod: "wallet",
      amount: walletPart,
      existingTransaction: walletTxn.transaction,
    });
    order.paidAmount = walletPart;
    order.remainingAmount = amount - walletPart;
    await order.save();
    await syncProjectFinalInvoice(order);
    await createPaymentTransaction({
      userId: user._id,
      transactionId: parentId,
      amount: amount - walletPart,
      upiTransactionId: "777777777777",
      paymentMethod: "upi",
      orderId: order._id,
      invoiceId: invoice._id,
      description: "ZZ project combined UPI portion",
    });

    const invalidApprovalId = `${parentId}-OVER`;
    await createPaymentTransaction({
      userId: user._id,
      transactionId: invalidApprovalId,
      amount: amount + 1,
      upiTransactionId: "777777777778",
      paymentMethod: "upi",
      orderId: order._id,
      invoiceId: invoice._id,
      description: "ZZ project invalid over-balance approval",
    });
    const invalidApproveRes = mockRes();
    await approveTransaction({ userRole: "admin", userId: String(user._id), params: { transactionId: invalidApprovalId } }, invalidApproveRes);
    const invalidApproval = await transactionModel.findOne({ transactionId: invalidApprovalId }).lean();
    check("over-balance approval stays pending", invalidApproveRes.statusCode === 500 && invalidApproval?.status === "pending", `response=${invalidApproveRes.statusCode}, status=${invalidApproval?.status}`);

    const rejectRes = mockRes();
    await rejectTransaction({
      userRole: "admin",
      userId: String(user._id),
      params: { transactionId: parentId },
      body: { rejectionReason: "regression combined rejection" },
    }, rejectRes);
    check("combined project payment rejected", rejectRes.statusCode === 200, rejectRes.body?.message);

    const [savedOrder, savedInvoice, finalInvoice, savedUser] = await Promise.all([
      orderModel.findById(order._id).lean(),
      invoiceModel.findById(invoice._id).lean(),
      invoiceModel.findOne({ orderId: order._id, invoiceType: "project_final" }).lean(),
      userModel.findById(user._id).select("walletBalance").lean(),
    ]);
    check("wallet portion refunded", Number(savedUser?.walletBalance) === walletPart, `balance=${savedUser?.walletBalance}`);
    check("project order balance reversed", Number(savedOrder?.paidAmount) === 0 && Number(savedOrder?.remainingAmount) === amount && savedOrder?.orderVisibility === "payment-rejected", `paid=${savedOrder?.paidAmount}, remaining=${savedOrder?.remainingAmount}, visibility=${savedOrder?.orderVisibility}`);
    check("project payment invoice reversed", Number(savedInvoice?.amountPaid) === 0 && savedInvoice?.status === "unpaid", `${savedInvoice?.status}:${savedInvoice?.amountPaid}`);
    check("final project statement re-synced", Number(finalInvoice?.amountPaid) === 0 && finalInvoice?.status === "unpaid", `${finalInvoice?.status}:${finalInvoice?.amountPaid}`);
  } finally {
    if (order?._id) {
      await invoiceModel.deleteMany({ orderId: order._id });
      await orderModel.deleteOne({ _id: order._id });
    }
    if (user?._id) {
      await transactionModel.deleteMany({ userId: user._id });
      await userModel.deleteOne({ _id: user._id });
    }
    check("teardown removed test data", !order?._id || !(await orderModel.exists({ _id: order._id })));
    await mongoose.disconnect();
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (error) => {
  console.error("Regression check crashed:", error);
  try { await mongoose.disconnect(); } catch (e) {}
  process.exit(1);
});
