const Ticket = require('../../models/ticketModel');
const mongoose = require('mongoose');

const getUserTicketsController = async (req, res) => {
  try {
    const userId = req.userId; // From auth middleware
    console.log("Fetching tickets for user:", userId);
    
     // Build query based on filters
     const query = { userId: new mongoose.Types.ObjectId(userId) };
    const { status } = req.query;

    if (status && ['pending', 'open', 'closed'].includes(status)) {
      query.status = status;
    }
    
    console.log("Query:", query); // Debug log

    // Get tickets with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const tickets = await Ticket.find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('ticketId category subject status createdAt updatedAt statusHistory');

      console.log("Found tickets:", tickets.length); 
    
    const totalTickets = await Ticket.countDocuments(query);
    
    res.status(200).json({
      message: "Tickets fetched successfully",
      data: {
        tickets,
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
    console.error("Error in getUserTicketsController:", err); 
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false
    });
  }
};

module.exports = getUserTicketsController;