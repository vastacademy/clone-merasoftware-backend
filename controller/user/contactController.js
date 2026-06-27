
const ContactRequest = require('../../models/contactRequestModel');
const emailService = require('../../helpers/emailService');

const submitContact = async (req, res) => {
  try {
    const { name, email, phone, message, requestType = 'account_creation', productId } = req.body;
    
    // Validate input
    if (!name || !email || !phone) {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide name, email, and phone number' 
      });
    }
    
    // Create new contact request
    const newContact = new ContactRequest({
      name,
      email,
      phone,
      message,
      productId: productId || null,
      requestType,
      status: 'new'
    });
    
    // Save to database
    await newContact.save();
    
    // Send confirmation email to user
    await emailService.sendContactFormConfirmation({
      name,
      email,
      phone,
      message,
      requestType
    });
    
    // Send notification to admin
    const adminEmail = process.env.ADMIN_EMAIL || 'vacomputers.com@gmail.com';
    await emailService.sendContactRequestNotification(
      {
        name,
        email,
        phone,
        message,
        requestType,
        productId
      },
      adminEmail
    );
    
    return res.status(201).json({
      success: true,
      message: 'Your request has been submitted successfully!'
    });
  } catch (error) {
    console.error('Contact form error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
};

module.exports = submitContact;