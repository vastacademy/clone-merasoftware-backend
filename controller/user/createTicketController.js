const Ticket = require('../../models/ticketModel');
const User = require('../../models/userModel');

const createTicketController = async (req, res) => {
  try {
    const { category, subject, description } = req.body;
    const userId = req.userId; // From auth middleware
    console.log("Creating ticket for user:", req.userId);
    
    // Check if required fields are provided
    if (!category || !subject || !description) {
      throw new Error("Please provide category, subject and description");
    }
    
    // Check if user already has an open ticket
    const existingOpenTicket = await Ticket.findOne({
      userId: userId,
      status: { $ne: 'closed' }
    });
    
    if (existingOpenTicket) {
      return res.status(400).json({
        message: "You already have an open ticket. Please wait for resolution before creating a new one.",
        error: true,
        success: false,
        ticketId: existingOpenTicket.ticketId
      });
    }

    // Create ticket with explicit ticketId
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const randomDigits = Math.floor(10000 + Math.random() * 90000);
    const ticketId = `TKT-${year}${month}-${randomDigits}`;
    
    // Create new ticket
    const newTicket = new Ticket({
      userId,
      ticketId,
      category,
      subject,
      description,
      status: 'pending',
      messages: [{
        sender: 'user',
        message: description
      }]
    });
    
    await newTicket.save();
    
    res.status(201).json({
      message: "Ticket created successfully",
      data: {
        ticketId: newTicket.ticketId,
        status: newTicket.status
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

module.exports = createTicketController;