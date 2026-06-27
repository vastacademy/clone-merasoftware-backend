const Ticket = require('../../models/ticketModel');
const uploadProductPermission = require('../../helpers/permission');

const closeTicketController = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.userId; // From auth middleware
    
    if (!ticketId) {
      throw new Error("Please provide ticketId");
    }
    
    // Check if admin
    const isAdmin = await uploadProductPermission(userId);
    if (!isAdmin) {
      return res.status(403).json({
        message: "Only admin can close tickets",
        error: true,
        success: false
      });
    }
    
    // Find the ticket
    const ticket = await Ticket.findOne({ ticketId });
    
    if (!ticket) {
      return res.status(404).json({
        message: "Ticket not found",
        error: true,
        success: false
      });
    }
    
    // Check if the ticket is already closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        message: "Ticket is already closed",
        error: true,
        success: false
      });
    }
    
    // Close the ticket
    ticket.status = 'closed';
    ticket.statusHistory.push({
      status: 'closed',
      timestamp: Date.now(),
      updatedBy: userId
    });
    
    ticket.updatedAt = Date.now();
    await ticket.save();
    
    res.status(200).json({
      message: "Ticket closed successfully",
      data: {
        ticketId: ticket.ticketId,
        status: ticket.status
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

module.exports = closeTicketController;