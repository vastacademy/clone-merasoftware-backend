const PDFDocument = require("pdfkit");

const money = (value) => `Rs ${Number(value || 0).toLocaleString("en-IN")}`;
const date = (value) => (value ? new Date(value).toLocaleDateString("en-IN") : "—");
const ordinal = (value) => {
  const labels = ["1st", "2nd", "3rd"];
  return labels[Number(value) - 1] || `${value}th`;
};

const generateProjectFinalInvoicePdf = ({ invoice, order, customer, transactions }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const total = Number(invoice.amount || 0);
    const paid = Number(invoice.amountPaid || 0);
    const balance = Math.max(0, total - paid);
    let y = 48;
    doc.fontSize(20).fillColor("#0f172a").text("FINAL PROJECT INVOICE", 48, y);
    y += 32;
    doc.fontSize(10).fillColor("#475569").text(`Invoice: ${invoice.invoiceNumber}`, 48, y);
    doc.text(`Updated: ${date(invoice.updatedAt || invoice.invoiceDate)}`, 360, y, { align: "right" });
    y += 28;
    doc.fillColor("#0f172a").fontSize(11).text(`Project: ${order.productId?.serviceName || "Project"}`, 48, y);
    y += 17;
    doc.fontSize(10).fillColor("#475569").text(`Customer: ${customer.name || "Customer"} · ${customer.email || ""}`, 48, y);
    y += 34;
    doc.fillColor("#0f172a").fontSize(12).text("Project total", 48, y).text(money(total), 420, y, { align: "right" });
    y += 22;
    doc.fillColor("#047857").text("Received", 48, y).text(money(paid), 420, y, { align: "right" });
    y += 22;
    doc.fillColor(balance ? "#b45309" : "#047857").text(balance ? "Outstanding" : "Balance", 48, y).text(money(balance), 420, y, { align: "right" });
    y += 38;
    doc.fillColor("#0f172a").fontSize(12).text("Payment history", 48, y);
    y += 22;
    if (!transactions.length) {
      doc.fontSize(10).fillColor("#64748b").text("No completed payment has been recorded yet.", 48, y);
    } else {
      transactions.forEach((transaction) => {
        if (y > 700) { doc.addPage(); y = 48; }
        const label = transaction.installmentNumber
          ? `${ordinal(transaction.installmentNumber)} Installment · ${String(transaction.paymentMethod || "payment").toUpperCase()}`
          : `Full Payment · ${String(transaction.paymentMethod || "payment").toUpperCase()}`;
        doc.fontSize(10).fillColor("#0f172a").text(label, 48, y);
        doc.text(money(transaction.amount), 420, y, { align: "right" });
        y += 15;
        doc.fontSize(8).fillColor("#64748b").text(`Ref: ${transaction.upiTransactionId || transaction.transactionId} · ${date(transaction.date || transaction.createdAt)}`, 48, y);
        y += 19;
      });
    }
    y += 16;
    doc.fontSize(9).fillColor("#64748b").text(
      balance ? "This is a live payment summary. The outstanding balance remains payable." : "Payment complete. This document confirms the full project payment.",
      48,
      y,
      { width: 500 }
    );
    doc.end();
  });

module.exports = { generateProjectFinalInvoicePdf };
