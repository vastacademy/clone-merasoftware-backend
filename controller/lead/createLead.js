const leadModel = require("../../models/leadModel");

const createLeadController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { name, phone, email, source, notes } = req.body;

    const cleanName = (name || "").trim();
    const cleanPhone = (phone || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanName) {
      return res.status(400).json({
        message: "Please provide lead name",
        error: true,
        success: false,
      });
    }

    if (!cleanPhone) {
      return res.status(400).json({
        message: "Please provide a phone number",
        error: true,
        success: false,
      });
    }

    // Duplicate guard within leads only (phone or email match)
    const duplicateOr = [];
    if (cleanEmail) duplicateOr.push({ email: cleanEmail });
    if (cleanPhone) duplicateOr.push({ phone: cleanPhone });

    if (duplicateOr.length) {
      const existingLead = await leadModel.findOne({ $or: duplicateOr }).lean();
      if (existingLead) {
        return res.status(409).json({
          message: "A lead with this phone or email already exists",
          error: true,
          success: false,
        });
      }
    }

    const lead = new leadModel({
      name: cleanName,
      phone: cleanPhone,
      email: cleanEmail,
      source: (source || "").trim(),
      notes: notes || "",
      createdBy: req.userId,
    });

    const savedLead = await lead.save();

    return res.status(201).json({
      message: "Lead created successfully",
      data: savedLead,
      success: true,
      error: false,
    });
  } catch (error) {
    console.error("Error creating lead:", error);
    return res.status(400).json({
      message: error.message || "Failed to create lead",
      error: true,
      success: false,
    });
  }
};

module.exports = createLeadController;
