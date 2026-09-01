export const isOrderApproved = (order) => {
  const visibility = order?.orderVisibility;
  return visibility === "approved" || visibility === "visible";
};

