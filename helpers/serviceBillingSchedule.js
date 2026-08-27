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

  // Cycle 1's window is decided at purchase (servicePlanPurchase.js writes
  // serviceCurrentCycleStart/End from the plan's own validity), so it does NOT need a
  // billing-cycle length. serviceBillingCycleMonths is only set when the customer picks
  // one of the plan's billingOptions — a plan sold on plain validity has none, and
  // demanding it here threw "Service billing cycle is missing" while settling the FIRST
  // cycle. That throw landed mid-approval: the invoice had already been marked paid but
  // the transaction was still 'pending', so the order was left half-settled and could
  // never be approved again (the retry hit the invoice-balance guard). Only cycle 2+,
  // which must be projected forward, genuinely requires the length.
  if (Number(cycleNumber) <= 1) {
    const start = service.serviceCurrentCycleStart || service.servicePlanStartDate || now;
    const end =
      service.serviceCurrentCycleEnd ||
      service.servicePlanEndDate ||
      (cycleMonths ? addMonths(start, cycleMonths) : null);
    return { start, end };
  }

  if (!cycleMonths) throw new Error("Service billing cycle is missing");

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
