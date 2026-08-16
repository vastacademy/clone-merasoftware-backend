// READ-ONLY audit script. Does not write/update/delete anything.
// Purpose: investigate why the admin Payment & Invoices ledger dumps many transactions into
// "Wallet / General Payments" — check whether their orderId field is genuinely missing/null,
// and whether description/invoiceId/date can reliably point back to a specific order.
//
// Run:  node scripts/readOnlyAuditMissingOrderIdTransactions.js [customerId]
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
const orderProductModel = require("../models/orderProductModel");
require("../models/productModel");

const line = (s = "") => console.log(s);
const sep = () => line("-".repeat(72));

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const customerId = process.argv[2];
  const filter = customerId ? { userId: customerId } : {};

  const transactions = await transactionModel.find(filter).sort({ createdAt: -1 });

  const withOrderId = transactions.filter((t) => t.orderId);
  const withoutOrderId = transactions.filter((t) => !t.orderId);

  line(`Total transactions checked: ${transactions.length}`);
  line(`  with orderId set     : ${withOrderId.length}`);
  line(`  WITHOUT orderId      : ${withoutOrderId.length}`);
  sep();

  for (const t of withoutOrderId.slice(0, 30)) {
    line(`_id=${t._id}`);
    line(`  transactionId    : ${t.transactionId}`);
    line(`  type/sourceType  : ${t.type} / ${t.sourceType}`);
    line(`  description      : ${t.description}`);
    line(`  invoiceId        : ${t.invoiceId || "(none)"}`);
    line(`  isInstallmentPayment: ${t.isInstallmentPayment}, installmentNumber: ${t.installmentNumber}`);
    line(`  amount/date      : ${t.amount} / ${t.date || t.createdAt}`);

    if (t.invoiceId) {
      const inv = await invoiceModel.findById(t.invoiceId).select("orderId invoiceNumber");
      line(`  -> linked invoice.orderId: ${inv?.orderId || "(invoice has none either)"}`);
    }
    sep();
  }

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
