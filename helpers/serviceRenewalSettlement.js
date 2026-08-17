const orderModel = require('../models/orderProductModel');
const { addMonths } = require('./servicePlanPurchase');

const settleServiceRenewal = async ({ orderId, invoice, now = new Date() }) => {
  const service = await orderModel.findOne({ _id: orderId, isServicePlan: true });
  if (!service) throw new Error('Service order not found');
  if (invoice.status !== 'paid') return service;
  const months = Number(service.serviceBillingCycleMonths || 0);
  if (!months) throw new Error('Service billing cycle is missing');
  const start = service.serviceCurrentCycleEnd || now;
  const end = addMonths(start, months);
  service.serviceCurrentCycleNumber = Number(service.serviceCurrentCycleNumber || 0) + 1;
  service.serviceCurrentCycleStart = start;
  service.serviceCurrentCycleEnd = end;
  service.serviceNextBillingDate = end;
  service.serviceAccessUsedInCycle = 0;
  service.servicePlanStatus = 'active';
  await service.save();
  return service;
};

module.exports = { settleServiceRenewal };
