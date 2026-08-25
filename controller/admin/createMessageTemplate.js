const messageTemplateModel = require("../../models/messageTemplateModel");

const createMessageTemplateController = async (req, res) => {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const { name, message } = req.body;

    if (!name?.trim() || !message?.trim()) {
      return res.status(400).json({
        message: "Name and message are required",
        error: true,
        success: false,
      });
    }

    const created = await messageTemplateModel.create({
      name: name.trim(),
      message,
      createdBy: req.userId,
    });

    return res.json({
      message: "Message template saved",
      success: true,
      error: false,
      data: created,
    });
  } catch (error) {
    console.error("Error creating message template:", error);
    return res.status(500).json({
      message: error.message || "Failed to create message template",
      error: true,
      success: false,
    });
  }
};

module.exports = createMessageTemplateController;
