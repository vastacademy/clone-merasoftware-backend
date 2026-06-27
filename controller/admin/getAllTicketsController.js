const Ticket = require('../../models/ticketModel');
const uploadProductPermission = require('../../helpers/permission');

const getAllTicketsController = async (req, res) => {
  try {
    const userId = req.userId; // From auth middleware
    
    // Check if admin
    const isAdmin = await uploadProductPermission(userId);
    if (!isAdmin) {
      return res.status(403).json({
        message: "Only admin can view all tickets",
        error: true,
        success: false
      });
    }
    
    // Get filters from query params
    const { status, category, userId: filterUserId } = req.query;
    
    // Build query based on filters
    const query = {};
    if (status && ['pending', 'open', 'closed'].includes(status)) {
      query.status = status;
    }
    if (category) {
      query.category = category;
    }
    if (filterUserId) {
      query.userId = filterUserId;
    }
    
    // Get tickets with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const tickets = await Ticket.find(query)
      .populate('userId', 'name email')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalTickets = await Ticket.countDocuments(query);
    
    // Get counts for dashboard
    const pendingCount = await Ticket.countDocuments({ status: 'pending' });
    const openCount = await Ticket.countDocuments({ status: 'open' });
    const closedCount = await Ticket.countDocuments({ status: 'closed' });
    
    res.status(200).json({
      message: "Tickets fetched successfully",
      data: {
        tickets,
        counts: {
          pending: pendingCount,
          open: openCount,
          closed: closedCount,
          total: totalTickets
        },
        pagination: {
          total: totalTickets,
          page,
          limit,
          pages: Math.ceil(totalTickets / limit)
        }
      },
      success: true,
      error: false
    });
    
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false
    });
  }
};

module.exports = getAllTicketsController;