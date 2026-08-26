const addMonths = (date, months) => {
  const result = new Date(date);
  result.setMonth(result.getMonth() + Number(months || 0));
  return result;
};

const deriveTotalCycles = ({ tenureMonths, cycleMonths }) => {
  const tenure = Number(tenureMonths);
  const cycle = Number(cycleMonths);
  if (!Number.isInteger(tenure) || !Number.isInteger(cycle) || tenure < cycle || tenure % cycle !== 0) {
    throw new Error("Total tenure must be a whole multiple of the selected billing period");
  }
  return tenure / cycle;
};

const isFixedTenureService = (service) =>
  Boolean(service?.isServicePlan && Number.isInteger(Number(service?.serviceTotalCycles)) && Number(service.serviceTotalCycles) > 0);

const getNextCycleNumber = (service) => Number(service?.serviceCurrentCycleNumber || 0) + 1;

const isFinalCycle = (service, cycleNumber) =>
  isFixedTenureService(service) && Number(cycleNumber) >= Number(service.serviceTotalCycles);

const getCycleDates = (service, cycleNumber, now = new Date()) => {
  const cycleMonths = Number(service?.serviceBillingCycleMonths || 0);
  if (!cycleMonths) throw new Error("Service billing cycle is missing");

  if (Number(cycleNumber) <= 1) {
    const start = service.serviceCurrentCycleStart || service.servicePlanStartDate || now;
    return { start, end: service.serviceCurrentCycleEnd || addMonths(start, cycleMonths) };
  }

  const start = service.serviceCurrentCycleEnd || service.serviceNextBillingDate || now;
  return { start, end: addMonths(start, cycleMonths) };
};

module.exports = {
  addMonths,
  deriveTotalCycles,
  isFixedTenureService,
  getNextCycleNumber,
  isFinalCycle,
  getCycleDates,
};
