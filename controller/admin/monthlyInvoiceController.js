const monthlyInvoiceModel = require('../../models/monthlyInvoiceModel');
const orderProductModel = require('../../models/orderProductModel');
const userModel = require('../../models/userModel');
const { sendMonthlyInvoiceEmail, generateMonthlyInvoicePdf } = require('../../helpers/emailService');

// Get all invoices with filters
const getAllInvoices = async (req, res) => {
    try {
        const { status, userId, page = 1, limit = 20 } = req.query;

        // Build filter object
        const filter = {};
        if (status) filter.status = status;
        if (userId) filter.userId = userId;

        const skip = (page - 1) * limit;

        const invoices = await monthlyInvoiceModel
            .find(filter)
            .populate('userId', 'name email phone')
            .populate({
                path: 'orderId',
                populate: {
                    path: 'productId',
                    select: 'serviceName category'
                }
            })
            .populate('markedPaidBy', 'name email')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const totalCount = await monthlyInvoiceModel.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: invoices,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / limit),
                totalInvoices: totalCount,
                limit: parseInt(limit)
            }
        });
    } catch (error) {
        console.error('Error fetching invoices:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get single invoice by ID
const getInvoiceById = async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await monthlyInvoiceModel
            .findById(invoiceId)
            .populate('userId', 'name email phone address')
            .populate({
                path: 'orderId',
                populate: {
                    path: 'productId',
                    select: 'serviceName category monthlyRenewalPrice'
                }
            })
            .populate('markedPaidBy', 'name email');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        res.status(200).json({
            success: true,
            data: invoice
        });
    } catch (error) {
        console.error('Error fetching invoice:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get invoices for a specific user
const getUserInvoices = async (req, res) => {
    try {
        // If userId is in params, admin is viewing a specific user's invoices
        // If not, user is viewing their own invoices
        const userId = req.params.userId || req.userId;
        const { status } = req.query;

        const filter = { userId };
        if (status) filter.status = status;

        const invoices = await monthlyInvoiceModel
            .find(filter)
            .populate({
                path: 'orderId',
                populate: {
                    path: 'productId',
                    select: 'serviceName category'
                }
            })
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            data: invoices
        });
    } catch (error) {
        console.error('Error fetching user invoices:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Mark invoice as paid
const markInvoiceAsPaid = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { paymentMethod, transactionReference, notes } = req.body;
        const adminId = req.userId; // From auth middleware

        const invoice = await monthlyInvoiceModel.findById(invoiceId);

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice is already marked as paid'
            });
        }

        // Update invoice
        invoice.status = 'paid';
        invoice.paidDate = new Date();
        invoice.paymentMethod = paymentMethod;
        invoice.transactionReference = transactionReference;
        invoice.notes = notes;
        invoice.markedPaidBy = adminId;

        await invoice.save();

        res.status(200).json({
            success: true,
            message: 'Invoice marked as paid successfully',
            data: invoice
        });
    } catch (error) {
        console.error('Error marking invoice as paid:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Cancel invoice
const cancelInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { reason } = req.body;

        const invoice = await monthlyInvoiceModel.findById(invoiceId);

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cannot cancel a paid invoice'
            });
        }

        invoice.status = 'cancelled';
        invoice.notes = reason || invoice.notes;

        await invoice.save();

        res.status(200).json({
            success: true,
            message: 'Invoice cancelled successfully',
            data: invoice
        });
    } catch (error) {
        console.error('Error cancelling invoice:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Send reminder email for unpaid invoice
const sendInvoiceReminder = async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await monthlyInvoiceModel
            .findById(invoiceId)
            .populate('userId', 'name email')
            .populate({
                path: 'orderId',
                populate: {
                    path: 'productId'
                }
            });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice not found'
            });
        }

        if (invoice.status !== 'unpaid' && invoice.status !== 'overdue') {
            return res.status(400).json({
                success: false,
                message: 'Can only send reminders for unpaid or overdue invoices'
            });
        }

        // Generate PDF
        const invoicePdfBuffer = await generateMonthlyInvoicePdf(
            invoice.userId,
            invoice.orderId,
            invoice
        );

        // Send reminder email
        await sendMonthlyInvoiceEmail(
            invoice.userId,
            invoice.orderId,
            invoice,
            invoicePdfBuffer
        );

        // Update reminder count
        invoice.remindersSent = (invoice.remindersSent || 0) + 1;
        invoice.lastReminderDate = new Date();
        await invoice.save();

        res.status(200).json({
            success: true,
            message: 'Reminder email sent successfully',
            data: {
                remindersSent: invoice.remindersSent,
                lastReminderDate: invoice.lastReminderDate
            }
        });
    } catch (error) {
        console.error('Error sending invoice reminder:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Get invoice statistics
const getInvoiceStatistics = async (req, res) => {
    try {
        const stats = await monthlyInvoiceModel.aggregate([
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 },
                    totalAmount: { $sum: '$amount' }
                }
            }
        ]);

        const formattedStats = {
            total: 0,
            unpaid: 0,
            paid: 0,
            overdue: 0,
            cancelled: 0,
            totalUnpaidAmount: 0,
            totalPaidAmount: 0
        };

        stats.forEach(stat => {
            formattedStats.total += stat.count;
            if (stat._id === 'unpaid') {
                formattedStats.unpaid = stat.count;
                formattedStats.totalUnpaidAmount = stat.totalAmount;
            } else if (stat._id === 'paid') {
                formattedStats.paid = stat.count;
                formattedStats.totalPaidAmount = stat.totalAmount;
            } else if (stat._id === 'overdue') {
                formattedStats.overdue = stat.count;
                formattedStats.totalUnpaidAmount += stat.totalAmount;
            } else if (stat._id === 'cancelled') {
                formattedStats.cancelled = stat.count;
            }
        });

        res.status(200).json({
            success: true,
            data: formattedStats
        });
    } catch (error) {
        console.error('Error fetching invoice statistics:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// Check and update overdue invoices
const updateOverdueInvoices = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Find all unpaid invoices past due date
        const result = await monthlyInvoiceModel.updateMany(
            {
                status: 'unpaid',
                dueDate: { $lt: today }
            },
            {
                $set: { status: 'overdue' }
            }
        );

        res.status(200).json({
            success: true,
            message: `Updated ${result.modifiedCount} invoices to overdue status`,
            data: {
                updatedCount: result.modifiedCount
            }
        });
    } catch (error) {
        console.error('Error updating overdue invoices:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    getAllInvoices,
    getInvoiceById,
    getUserInvoices,
    markInvoiceAsPaid,
    cancelInvoice,
    sendInvoiceReminder,
    getInvoiceStatistics,
    updateOverdueInvoices
};
