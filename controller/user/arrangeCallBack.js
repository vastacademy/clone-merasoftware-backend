const ContactRequest = require('../../models/contactRequestModel');
const { sendCallbackConfirmation, sendCallbackRequestNotification } = require('../../helpers/emailService');
const { validateEmail } = require('../../helpers/emailValidator');

/**
 * Handle arrange callback form submission
 * Validates email with MX record check and blocks disposable/fake emails
 */
const arrangeCallBack = async (req, res) => {
  try {
    const { name, email, phone, serviceType } = req.body;

    // Validate required fields
    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Please provide name, email, and phone number'
      });
    }

    // Validate name length
    if (name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid name'
      });
    }

    // Validate phone number (basic check)
    if (phone.trim().length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone number'
      });
    }

    // Email validation with MX record check
    console.log(`Validating email: ${email}`);
    const emailValidation = await validateEmail(email);

    if (!emailValidation.isValid) {
      console.log(`Email validation failed for ${email}: ${emailValidation.message}`);
      return res.status(400).json({
        success: false,
        message: emailValidation.message || 'Invalid or disposable email address'
      });
    }

    console.log(`Email validation passed for ${email}`);

    // Create message from service type
    const message = serviceType && serviceType !== ''
      ? `${serviceType}`
      : 'Callback request from homepage';

    // Create new contact request
    const newCallbackRequest = new ContactRequest({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      message: message,
      requestType: 'account_creation',
      status: 'new'
    });

    // Save to database
    await newCallbackRequest.save();
    console.log(`Callback request saved to database for ${email}`);

    // Send confirmation email to user
    try {
      await sendCallbackConfirmation({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        message: message
      });
      console.log(`Callback confirmation email sent to user: ${email}`);
    } catch (emailError) {
      console.error('Error sending user confirmation email:', emailError);
      // Continue even if user confirmation fails
    }

    // Send notification to admin
    const adminEmail = process.env.ADMIN_EMAIL || 'vacomputers.com@gmail.com';
    try {
      await sendCallbackRequestNotification(
        {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          phone: phone.trim(),
          message: message
        },
        adminEmail
      );
      console.log(`Callback admin notification sent to: ${adminEmail}`);
    } catch (emailError) {
      console.error('Error sending admin notification email:', emailError);
      // Log error but don't fail the request
    }

    return res.status(201).json({
      success: true,
      message: 'Your callback request has been submitted successfully! We will reach out within 24 hours.'
    });

  } catch (error) {
    console.error('Arrange callback error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error. Please try again later.'
    });
  }
};

module.exports = arrangeCallBack;
