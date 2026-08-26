const PDFDocument = require("pdfkit");
const { getOrderDisplayName } = require("./orderPresentation");

const generateInvoiceDocumentPdf = ({ invoice, order, customer }) => new Promise((resolve, reject) => {
  const document = new PDFDocument({ margin: 48, size: "A4" });
  const chunks = [];
  document.on("data", (chunk) => chunks.push(chunk));
  document.on("end", () => resolve(Buffer.concat(chunks)));
  document.on("error", reject);

  const paid = Number(invoice.amountPaid || 0);
  const amount = Number(invoice.amount || 0);
  const balance = Math.max(0, amount - paid);
  const label = invoice.invoiceType === "service_statement"
    ? "SERVICE BILLING STATEMENT"
    : invoice.invoiceType === "project_final"
    ? "PROJECT PAYMENT STATEMENT"
    : "INVOICE";
  const items = Array.isArray(invoice.lineItems) && invoice.lineItems.length
    ? invoice.lineItems
    : [{ name: getOrderDisplayName(order, "Service"), price: amount }];

  document.fontSize(22).fillColor("#111827").text(label, { align: "center" });
  document.moveDown(1.4);
  document.fontSize(10).fillColor("#374151");
  document.text(`Invoice number: ${invoice.invoiceNumber}`);
  document.text(`Issued: ${new Date(invoice.invoiceDate).toLocaleDateString("en-IN")}`);
  document.text(`Due: ${new Date(invoice.dueDate).toLocaleDateString("en-IN")}`);
  document.text(`Status: ${String(invoice.status || "unpaid").replace(/_/g, " ").toUpperCase()}`);
  document.moveDown();
  document.fontSize(12).fillColor("#111827").text("Bill To");
  document.fontSize(10).fillColor("#374151").text(customer?.name || "Customer");
  if (customer?.email) document.text(customer.email);
  document.moveDown();
  document.fontSize(12).fillColor("#111827").text(getOrderDisplayName(order, "Service"));
  document.moveDown(0.5);
  document.fontSize(10).fillColor("#374151");
  items.forEach((item) => {
    document.text(String(item.name || "Item"), 48, document.y, { continued: true });
    document.text(`₹${Number(item.price || 0).toLocaleString("en-IN")}`, { align: "right" });
  });
  document.moveDown();
  document.fontSize(11).fillColor("#111827");
  document.text(`Invoice amount: ₹${amount.toLocaleString("en-IN")}`, { align: "right" });
  document.text(`Paid: ₹${paid.toLocaleString("en-IN")}`, { align: "right" });
  document.text(`Balance: ₹${balance.toLocaleString("en-IN")}`, { align: "right" });
  if (invoice.notes) {
    document.moveDown();
    document.fontSize(9).fillColor("#4b5563").text(invoice.notes);
  }
  document.end();
});

module.exports = { generateInvoiceDocumentPdf };
