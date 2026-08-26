const invoiceModel = require("../../models/invoiceModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const { generateInvoiceDocumentPdf } = require("../../helpers/generateInvoiceDocumentPdf");

const loadInvoiceForUser = async (invoiceId, req) => {
  const populate = [
    { path: "userId", select: "name email" },
    { path: "orderId", populate: { path: "productId", select: "serviceName" } },
  ];
  const invoice = await invoiceModel.findById(invoiceId).populate(populate)
    || await monthlyInvoiceModel.findById(invoiceId).populate(populate);
  if (!invoice) {
    const error = new Error("Invoice not found");
    error.statusCode = 404;
    throw error;
  }
  if (req.userRole !== "admin" && String(invoice.userId?._id || invoice.userId) !== String(req.userId)) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    throw error;
  }
  return invoice;
};

const sendInvoiceDocument = (disposition) => async (req, res) => {
  try {
    const invoice = await loadInvoiceForUser(req.params.invoiceId, req);
    const pdf = await generateInvoiceDocumentPdf({ invoice, order: invoice.orderId, customer: invoice.userId });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `${disposition}; filename=Invoice-${invoice.invoiceNumber || invoice._id}.pdf`);
    return res.send(pdf);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Unable to prepare invoice document", success: false, error: true });
  }
};

module.exports = {
  viewInvoiceDocument: sendInvoiceDocument("inline"),
  downloadInvoiceDocument: sendInvoiceDocument("attachment"),
};
