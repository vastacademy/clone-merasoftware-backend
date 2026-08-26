const invoiceModel = require("../../models/invoiceModel");
const transactionModel = require("../../models/transactionModel");
const { Resend } = require("resend");
const { generateProjectFinalInvoicePdf } = require("../../helpers/generateProjectFinalInvoicePdf");

const resend = new Resend(process.env.RESEND_API_KEY);

const loadFinalInvoice = async (invoiceId) => {
  const invoice = await invoiceModel.findOne({ _id: invoiceId, invoiceType: "project_final" })
    .populate("userId", "name email")
    .populate({ path: "orderId", select: "productId projectSnapshot servicePlanSnapshot orderItems", populate: { path: "productId", select: "serviceName" } });
  if (!invoice) {
    const error = new Error("Final project invoice not found");
    error.statusCode = 404;
    throw error;
  }
  const transactions = await transactionModel.find({
    orderId: invoice.orderId._id,
    type: "payment",
    status: "completed",
  }).sort({ date: 1, createdAt: 1 }).lean();
  return { invoice, transactions };
};

const requireAdmin = (req, res) => {
  if (req.userRole === "admin") return true;
  res.status(403).json({ message: "Forbidden", success: false, error: true });
  return false;
};

const sendProjectFinalInvoicePdf = async (req, res, disposition) => {
  const { invoice, transactions } = await loadFinalInvoice(req.params.invoiceId);
  const pdf = await generateProjectFinalInvoicePdf({ invoice, order: invoice.orderId, customer: invoice.userId, transactions });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disposition}; filename=${invoice.invoiceNumber}.pdf`);
  return res.send(pdf);
};

const downloadProjectFinalInvoice = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    return await sendProjectFinalInvoicePdf(req, res, "attachment");
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to download final invoice", success: false, error: true });
  }
};

const viewProjectFinalInvoice = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    return await sendProjectFinalInvoicePdf(req, res, "inline");
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to view final invoice", success: false, error: true });
  }
};

const resendProjectFinalInvoice = async (req, res) => {
  try {
    if (!requireAdmin(req, res)) return;
    const { invoice, transactions } = await loadFinalInvoice(req.params.invoiceId);
    if (!invoice.userId?.email) throw new Error("Customer email is not available");
    const pdf = await generateProjectFinalInvoicePdf({ invoice, order: invoice.orderId, customer: invoice.userId, transactions });
    const result = await resend.emails.send({
      from: `${process.env.FROM_NAME || "Mera Software"} <${process.env.FROM_EMAIL}>`,
      to: [invoice.userId.email],
      subject: `Project payment summary - ${invoice.invoiceNumber}`,
      html: `<p>Hello ${invoice.userId.name || "Customer"},</p><p>Your current project payment summary is attached.</p>`,
      attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdf }],
    });
    if (result.error) throw new Error("Final invoice email could not be sent");
    return res.status(200).json({ message: "Final invoice shared by email", success: true, error: false });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || "Failed to share final invoice", success: false, error: true });
  }
};

module.exports = { downloadProjectFinalInvoice, viewProjectFinalInvoice, resendProjectFinalInvoice };
