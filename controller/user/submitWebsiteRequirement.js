const emailService = require("../../helpers/emailService"); 

const submitWebsiteRequirement = async (req, res) => {
  try {
    const {
      fullName,
      emailAddress,
      phoneNumber,
      companyName,
      businessCategory,
      businessType,
      updatePlan,
      whoUpdates,
      budgetRange,
      contactPreference,
      requirements,
    } = req.body;

    // Input validation (आप अपनी आवश्यकतानुसार और validation जोड़ सकते हैं)
    if (
      !fullName ||
      !emailAddress ||
      !phoneNumber ||
      !businessCategory ||
      !businessType ||
      !updatePlan ||
      !budgetRange ||
      !contactPreference ||
      !requirements
    ) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields.",
      });
    }

    // 'whoUpdates' केवल तभी आवश्यक है जब updatePlan 'occasional' या 'mostly' हो
    if (
      (updatePlan === "occasional" || updatePlan === "mostly") &&
      !whoUpdates
    ) {
      return res.status(400).json({
        success: false,
        message: "Please specify who will do the updates.",
      });
    }

    // Admin को ईमेल भेजें
    const adminEmail = process.env.ADMIN_EMAIL || "merasoftwareofficial@gmail.com"; // .env से या डिफ़ॉल्ट
    await emailService.sendWebsiteRequirementNotification(
      {
        fullName,
        emailAddress,
        phoneNumber,
        companyName,
        businessCategory,
        businessType,
        updatePlan,
        whoUpdates,
        budgetRange,
        contactPreference,
        requirements,
      },
      adminEmail
    );

    // User को पुष्टिकरण ईमेल भेजें (वैकल्पिक, लेकिन अच्छा अभ्यास)
    await emailService.sendWebsiteRequirementConfirmation({
      fullName,
      emailAddress,
      businessCategory,
      businessType,
      updatePlan,
      budgetRange,
      contactPreference,
    });

    return res.status(200).json({
      success: true,
      message: "Your website requirements have been submitted successfully!",
    });
  } catch (error) {
    console.error("Error submitting website requirements:", error);
    return res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

module.exports = submitWebsiteRequirement;
