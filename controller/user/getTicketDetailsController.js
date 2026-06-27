const Ticket = require('../../models/ticketModel');
const User = require('../../models/userModel');
const uploadProductPermission = require('../../helpers/permission');

const getTicketDetailsController = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.userId; // From auth middleware

    console.log("Request to get ticket details:", { ticketId, userId });
    
    if (!ticketId) {
      throw new Error("Please provide ticketId");
    }
    
    // Find the ticket
    const ticket = await Ticket.findOne({ ticketId }).populate('userId', 'name email');
    
    if (!ticket) {
      return res.status(404).json({
        message: "Ticket not found",
        error: true,
        success: false
      });
    }
    
    // Check if the user is authorized (either the ticket owner or admin)
    const isAdmin = await uploadProductPermission(userId);
    console.log("User permissions:", { isAdmin, userId, ticketUserId: ticket.userId._id.toString() });
    
    if (!isAdmin && ticket.userId._id.toString() !== userId) {
      return res.status(403).json({
        message: "You are not authorized to view this ticket",
        error: true,
        success: false
      });
    }
    
    // If admin is viewing the ticket for the first time and it's pending, update to open
    if (isAdmin && ticket.status === 'pending') {
      ticket.status = 'open';
      ticket.statusHistory.push({
        status: 'open',
        timestamp: Date.now(),
        updatedBy: userId
      });
      await ticket.save();
    }
    
    res.status(200).json({
      message: "Ticket details fetched successfully",
      data: ticket,
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

module.exports = getTicketDetailsController;