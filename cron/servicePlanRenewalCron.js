const cron = require('node-cron');
const orderModel = require('../models/orderProductModel');
const invoiceModel = require('../models/invoiceModel');
const { createProjectInvoice } = require('../helpers/paymentRecording');

const resolveRenewalPrice = (service) => {
  const snapshot = service.servicePlanSnapshot || {};
  return Number((snapshot.billingOptions || []).find((item) => item.billingCycle === service.serviceSelectedBillingCycle)?.pricePerCycle || 0);
};

const processServicePlanRenewals = async (now = new Date()) => {
  const dueServices = await orderModel.find({ isServicePlan: true, servicePlanStatus: 'active', serviceNextBillingDate: { $lte: now } });
  for (const service of dueServices) {
    if (!service.serviceAutoRenew) {
      service.servicePlanStatus = 'inactive';
      await service.save();
      continue;
    }
    const existing = await invoiceModel.findOne({ orderId: service._id, invoiceType: 'plan_renewal', status: { $in: ['unpaid', 'partially_paid', 'overdue'] } });
    if (existing) {
      service.servicePlanStatus = 'paused';
      await service.save();
      continue;
    }
    const amount = resolveRenewalPrice(service);
    if (!(amount > 0)) continue;
    await createProjectInvoice({ customerId: service.userId, orderId: service._id, amount, lineItems: [{ name: `Renewal: ${service.orderItems?.[0]?.name || 'Service'}`, price: amount }], invoiceDate: now, dueDate: now, invoiceType: 'plan_renewal' });
    service.servicePlanStatus = 'paused';
    await service.save();
  }
};

const scheduleServicePlanRenewals = () => cron.schedule('5 1 * * *', () => processServicePlanRenewals().catch((error) => console.error('Service renewal cron failed:', error.message)), { timezone: 'Asia/Kolkata' });
module.exports = { processServicePlanRenewals, scheduleServicePlanRenewals };
