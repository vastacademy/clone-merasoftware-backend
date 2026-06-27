const userModel = require("../../models/userModel");
const { generateOTP, saveOTP, sendOTPEmail } = require('../../helpers/otpUtils');
const otpModel = require("../../models/otpModel");

async function resendOtpController(req, res) {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            throw new Error("User ID is required");
        }
        
        // Get user details
        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found");
        }
        
        // Check if user is already OTP verified
        if (user.isOtpVerified) {
            // Check if existing OTP is expired
            const existingOtp = await otpModel.findOne({ userId }).sort({ createdAt: -1 });
            if (existingOtp) {
                const now = Date.now();
                const createdAt = new Date(existingOtp.createdAt).getTime();
                const isExpired = now - createdAt > 5 * 60 * 1000; // 5 minutes

                if (!isExpired) {
                    throw new Error("User is already verified");
                } else {
                    // OTP expired, reset isOtpVerified to false
                    await userModel.findByIdAndUpdate(userId, { isOtpVerified: false });
                }
            } else {
                // No OTP found, reset isOtpVerified to false to allow resend
                await userModel.findByIdAndUpdate(userId, { isOtpVerified: false });
            }
        }

       // Check if previous OTP exists and is still valid
    const existingOtp = await otpModel.findOne({ userId }).sort({ createdAt: -1 });

    if (existingOtp) {
      const now = Date.now();
      const createdAt = new Date(existingOtp.createdAt).getTime();
      const isExpired = now - createdAt > 5 * 60 * 1000; // 5 minutes

      if (!isExpired) {
        throw new Error("Current OTP is still valid. Please wait before requesting again.");
      }
    }
        
        // Generate and send new OTP
    const newOtp = generateOTP();
    const otpSaved = await saveOTP(userId, newOtp);
    const emailSent = await sendOTPEmail(user.email, newOtp, user.name);

    if (!otpSaved || !emailSent) {
      throw new Error("Failed to send OTP. Please try again.");
    } 
    
        res.status(200).json({
            message: "New OTP sent to your email",
            success: true,
            error: false
        });
    } catch (err) {
        res.json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

module.exports = resendOtpController;