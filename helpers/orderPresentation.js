// Order presentation SSOT. A project may be a catalogue-backed purchase or a
// client-specific project whose commercial scope is frozen in projectSnapshot.
// Never make a client project depend on a catalogue product merely to display
// its own agreed name/category.
const getOrderDisplayName = (order, fallback = "Service") =>
  order?.projectSnapshot?.displayName ||
  order?.productId?.serviceName ||
  order?.servicePlanSnapshot?.serviceName ||
  fallback;

const getOrderCategory = (order, fallback = "") =>
  order?.projectSnapshot?.category || order?.productId?.category || fallback;

module.exports = {
  getOrderDisplayName,
  getOrderCategory,
};
