const { stopServiceRenewal } = require('../../helpers/serviceLifecycle');

module.exports = async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ success: false, error: true, message: 'Authentication required' });
    const service = await stopServiceRenewal({ serviceOrderId: req.body?.serviceOrderId, userId: req.userId });
    return res.json({ success: true, error: false, message: 'Renewal will stop after the current paid period', data: service });
  } catch (error) {
    return res.status(400).json({ success: false, error: true, message: error.message || 'Could not stop renewal' });
  }
};
