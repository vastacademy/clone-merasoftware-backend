const Ticket = require('../../models/ticketModel');
const uploadProductPermission = require('../../helpers/permission');

const replyTicketController = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    const userId = req.userId; // From auth middleware
    
    if (!ticketId || !message) {
      throw new Error("Please provide ticketId and message");
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
    
    // Check if the ticket is closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        message: "Cannot reply to a closed ticket",
        error: true,
        success: false
      });
    }
    
    // Check if the user is authorized (either the ticket owner or admin)
    const isAdmin = await uploadProductPermission(userId);
    
    if (!isAdmin && ticket.userId.toString() !== userId) {
      return res.status(403).json({
        message: "You are not authorized to reply to this ticket",
        error: true,
        success: false
      });
    }
    
    // Add the reply
    ticket.messages.push({
      sender: isAdmin ? 'admin' : 'user',
      message
    });
    
    // If admin is replying and ticket is pending, update to open
    if (isAdmin && ticket.status === 'pending') {
      ticket.status = 'open';
      ticket.statusHistory.push({
        status: 'open',
        timestamp: Date.now(),
        updatedBy: userId
      });
    }
    
    ticket.updatedAt = Date.now();
    await ticket.save();
    
    res.status(200).json({
      message: "Reply added successfully",
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

module.exports = replyTicketController;