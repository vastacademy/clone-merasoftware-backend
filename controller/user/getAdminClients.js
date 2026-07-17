const userModel = require("../../models/userModel");
const orderModel = require("../../models/orderProductModel");
const updateRequestModel = require("../../models/updateRequestModel");
const transactionModel = require("../../models/transactionModel");
const monthlyInvoiceModel = require("../../models/monthlyInvoiceModel");
const TicketModel = require("../../models/ticketModel");

const toTimestamp = (value) => {
  const timestamp = value ? new Date(value).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const isActiveOrder = (order) => {
  if (!order || order.orderVisibility === "pending-approval" || order.orderVisibility === "payment-rejected" || order.orderVisibility === "hidden") {
    return false;
  }

  if (["completed", "cancelled", "canceled", "rejected"].includes(order.status)) {
    return false;
  }

  if (order.projectProgress >= 100 || order.currentPhase === "completed") {
    return false;
  }

  if (order.planStatus === "closed" || order.autoRenewalStatus === "expired") {
    return false;
  }

  if (order.isActive === false) {
    return false;
  }

  return order.status === "in_progress" || order.isActive === true;
};

const getLatestActivity = (client, records) => {
  const activities = [
    { value: client.updatedAt, type: "client_updated" },
    { value: client.createdAt, type: "client_created" },
  ];

  records.forEach(({ items, updatedField = "updatedAt", createdField = "createdAt", type }) => {
    items.forEach((item) => {
      activities.push({ value: item?.[updatedField], type });
      activities.push({ value: item?.[createdField], type: `${type}_created` });
      if (item?.lastUpdated) activities.push({ value: item.lastUpdated, type });
      if (item?.date) activities.push({ value: item.date, type });
      if (item?.invoiceDate) activities.push({ value: item.invoiceDate, type });
    });
  });

  return activities.reduce(
    (latest, activity) => (toTimestamp(activity.value) > latest.timestamp
      ? { timestamp: toTimestamp(activity.value), value: activity.value, type: activity.type }
      : latest),
    { timestamp: 0, value: null, type: null }
  );
};

async function getAdminClients(req, res) {
  try {
    if (req.userRole !== "admin") {
      return res.status(403).json({
        message: "Forbidden",
        error: true,
        success: false,
      });
    }

    const clients = await userModel
      .find({ roles: "customer" })
      .select("name email phone roles createdAt updatedAt profilePic userDetails walletBalance status referredBy")
      .lean();

    const customerIds = clients.map((client) => client._id);
    const [orders, updateRequests, transactions, invoices, tickets] = await Promise.all([
      orderModel.find({ userId: { $in: customerIds } }).select("userId status orderVisibility projectProgress currentPhase isActive planStatus autoRenewalStatus createdAt updatedAt lastUpdated").lean(),
      updateRequestModel.find({ userId: { $in: customerIds } }).select("userId createdAt updatedAt completedAt").lean(),
      transactionModel.find({ userId: { $in: customerIds } }).select("userId createdAt updatedAt date").lean(),
      monthlyInvoiceModel.find({ userId: { $in: customerIds } }).select("userId createdAt updatedAt invoiceDate paidDate").lean(),
      TicketModel.find({ userId: { $in: customerIds } }).select("userId createdAt updatedAt").lean(),
    ]);

    const recordsByUser = new Map();
    const addRecords = (items, type) => {
      items.forEach((item) => {
        const key = String(item.userId);
        if (!recordsByUser.has(key)) recordsByUser.set(key, []);
        recordsByUser.get(key).push({ item, type });
      });
    };

    addRecords(orders, "order");
    addRecords(updateRequests, "update_request");
    addRecords(transactions, "transaction");
    addRecords(invoices, "invoice");
    addRecords(tickets, "ticket");

    const enrichedClients = clients.map((client) => {
      const clientRecords = recordsByUser.get(String(client._id)) || [];
      const clientOrders = clientRecords.filter((record) => record.type === "order").map((record) => record.item);
      const latestActivity = getLatestActivity(
        client,
        clientRecords.map((record) => ({ items: [record.item], type: record.type }))
      );

      return {
        ...client,
        hasActiveWork: clientOrders.some(isActiveOrder),
        latestActivityAt: latestActivity.value || client.updatedAt || client.createdAt || null,
        latestActivityType: latestActivity.type,
      };
    });

    enrichedClients.sort((left, right) => {
      if (left.hasActiveWork !== right.hasActiveWork) return left.hasActiveWork ? -1 : 1;
      const activityDifference = toTimestamp(right.latestActivityAt) - toTimestamp(left.latestActivityAt);
      if (activityDifference) return activityDifference;
      return (left.name || "").localeCompare(right.name || "", "en", { sensitivity: "base" });
    });

    res.json({
      message: "Clients fetched successfully",
      data: enrichedClients,
      success: true,
      error: false,
    });
  } catch (err) {
    res.status(400).json({
      message: err.message || err,
      error: true,
      success: false,
    });
  }
}

module.exports = getAdminClients;
