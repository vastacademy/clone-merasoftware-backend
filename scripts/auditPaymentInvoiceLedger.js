require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const transactionModel = require("../models/transactionModel");
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel");

const getArgValue = (name) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
};

const hasFlag = (name) => process.argv.includes(`--${name}`);

const buildUserFilter = (query) => {
  if (!query) return {};
  return {
    $or: [
      { name: new RegExp(query, "i") },
      { email: new RegExp(query, "i") },
      { phone: new RegExp(query, "i") },
    ],
  };
};

const summarizeStatusCounts = (items, key) =>
  items.reduce((acc, item) => {
    const status = item[key] || "null";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

const run = async () => {
  const userQuery = getArgValue("user");
  const shouldApply = hasFlag("apply");

  await mongoose.connect(process.env.MONGODB_URI);

  const users = await userModel
    .find(buildUserFilter(userQuery))
    .select("name email phone walletBalance")
    .lean();

  const reports = [];

  for (const user of users) {
    const [invoices, transactions] = await Promise.all([
      monthlyInvoiceModel.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
      transactionModel.find({ userId: user._id }).sort({ createdAt: 1 }).lean(),
    ]);

    const completedByInvoiceId = new Set(
      transactions
        .filter((transaction) => transaction.status === "completed" && transaction.invoiceId)
        .map((transaction) => String(transaction.invoiceId))
    );

    const paidInvoicesMissingTransaction = invoices
      .filter((invoice) => invoice.status === "paid" && !completedByInvoiceId.has(String(invoice._id)))
      .map((invoice) => ({
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber,
        orderId: String(invoice.orderId),
        amount: invoice.amount,
        paidDate: invoice.paidDate,
        paymentMethod: invoice.paymentMethod,
        transactionReference: invoice.transactionReference,
      }));

    const backfilledTransactions = [];
    if (shouldApply) {
      for (const invoice of invoices.filter(
        (item) => item.status === "paid" && !completedByInvoiceId.has(String(item._id))
      )) {
        const transactionId = `BACKFILL-${String(invoice.invoiceNumber || invoice._id).replace(/[^a-zA-Z0-9]/g, "")}`;
        const existingByTransactionId = await transactionModel.findOne({ transactionId }).lean();
        if (existingByTransactionId) {
          backfilledTransactions.push({
            invoiceId: String(invoice._id),
            invoiceNumber: invoice.invoiceNumber,
            skipped: true,
            reason: "transactionId already exists",
            transactionId,
          });
          continue;
        }

        const created = await transactionModel.create({
          userId: invoice.userId,
          orderId: invoice.orderId,
          invoiceId: invoice._id,
          transactionId,
          upiTransactionId: invoice.transactionReference || transactionId,
          amount: invoice.amount,
          status: "completed",
          paymentStatus: "approved",
          type: "renewal",
          sourceType: "invoice",
          description: `Backfilled payment ledger for invoice ${invoice.invoiceNumber || invoice._id}`,
          paymentMethod: invoice.paymentMethod || "cash",
          verifiedBy: invoice.markedPaidBy || null,
          verificationDate: invoice.paidDate || invoice.updatedAt || new Date(),
          date: invoice.paidDate || invoice.updatedAt || new Date(),
          renewalNumber: invoice.renewalMonth || null,
          renewalPeriodStart: invoice.renewalPeriodStart || null,
          renewalPeriodEnd: invoice.renewalPeriodEnd || null,
        });

        backfilledTransactions.push({
          invoiceId: String(invoice._id),
          invoiceNumber: invoice.invoiceNumber,
          skipped: false,
          transactionId: created.transactionId,
          transactionObjectId: String(created._id),
        });
      }
    }

    const unpaidInvoicesWithCompletedTransaction = invoices
      .filter((invoice) => invoice.status !== "paid" && completedByInvoiceId.has(String(invoice._id)))
      .map((invoice) => ({
        invoiceId: String(invoice._id),
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amount: invoice.amount,
      }));

    reports.push({
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        walletBalance: user.walletBalance || 0,
      },
      counts: {
        invoices: summarizeStatusCounts(invoices, "status"),
        transactions: summarizeStatusCounts(transactions, "status"),
        sourceTypes: summarizeStatusCounts(transactions, "sourceType"),
      },
      mismatches: {
        paidInvoicesMissingTransaction,
        unpaidInvoicesWithCompletedTransaction,
      },
      backfill: {
        mode: shouldApply ? "apply" : "dry-run",
        wouldCreate: paidInvoicesMissingTransaction.length,
        created: backfilledTransactions,
      },
    });
  }

  console.log(JSON.stringify({ userQuery: userQuery || null, apply: shouldApply, matchedUsers: reports.length, reports }, null, 2));
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {
    // Ignore disconnect errors during failure handling.
  }
  process.exit(1);
});
