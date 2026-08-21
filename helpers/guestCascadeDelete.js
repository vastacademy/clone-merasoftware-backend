const mongoose = require("mongoose");
const userModel = require("../models/userModel");
const leadModel = require("../models/leadModel");
const orderModel = require("../models/orderProductModel");
const updateRequestModel = require("../models/updateRequestModel");
const monthlyInvoiceModel = require("../models/monthlyInvoiceModel");
const transactionModel = require("../models/transactionModel");
const invoiceModel = require("../models/invoiceModel");
const ticketModel = require("../models/ticketModel");
const notificationModel = require("../models/notificationModel");
const { getActiveGamesForUser } = require("../chess/chessRoomManager");

// A guest with a live chess game (any status other than 'closed') must never be
// cascade-deleted mid-game — chess has no forfeit/abandon concept (games end by
// being deleted, not by a status transition), so there is no safe way to end the
// guest's side of the match automatically. Deferring is the only safe option.
const hasActiveChessGame = async (userId) => {
  const games = await getActiveGamesForUser(userId);
  return games.length > 0;
};

// Builds a read-only plan of what would be deleted for a given guest userId.
// Mirrors the shape/spirit of helpers/orderDeletePlan.js but scoped to a user.
const buildGuestDeletePlan = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const [
    user,
    orders,
    updateRequests,
    monthlyInvoices,
    transactions,
    invoices,
    tickets,
    notifications,
    activeGames,
  ] = await Promise.all([
    userModel.findById(userObjectId).select("isGuest guestLeadId"),
    orderModel.find({ userId: userObjectId }).select("_id"),
    updateRequestModel.find({ userId: userObjectId }).select("_id"),
    monthlyInvoiceModel.find({ userId: userObjectId }).select("_id"),
    transactionModel.find({ userId: userObjectId }).select("_id"),
    invoiceModel.find({ userId: userObjectId }).select("_id"),
    ticketModel.find({ userId: userObjectId }).select("_id"),
    notificationModel.find({ userId: userObjectId }).select("_id"),
    getActiveGamesForUser(userObjectId),
  ]);

  return {
    userPresent: Boolean(user),
    isGuest: Boolean(user?.isGuest),
    guestLeadId: user?.guestLeadId || null,
    blockedByActiveGame: activeGames.length > 0,
    counts: {
      orders: orders.length,
      updateRequests: updateRequests.length,
      monthlyInvoices: monthlyInvoices.length,
      transactions: transactions.length,
      invoices: invoices.length,
      tickets: tickets.length,
      notifications: notifications.length,
      activeChessGames: activeGames.length,
    },
  };
};

// Cascade-deletes a guest user and everything it created. Refuses to run if the
// user isn't actually flagged isGuest (safety guard against accidental misuse
// against a real customer), and refuses while a live chess game exists.
// Leaves the linked lead record untouched except clearing its guestUserId link.
const executeGuestCascadeDelete = async (userId) => {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  const user = await userModel.findById(userObjectId);
  if (!user) {
    return { deleted: false, reason: "user_not_found" };
  }
  if (!user.isGuest) {
    return { deleted: false, reason: "not_a_guest" };
  }

  if (await hasActiveChessGame(userObjectId)) {
    return { deleted: false, reason: "active_chess_game" };
  }

  const orders = await orderModel.find({ userId: userObjectId }).select("_id");
  const orderIds = orders.map((order) => order._id);

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    await updateRequestModel.deleteMany({ userId: userObjectId }).session(session);
    await monthlyInvoiceModel.deleteMany({ orderId: { $in: orderIds } }).session(session);
    await transactionModel.deleteMany({ userId: userObjectId }).session(session);
    await invoiceModel.deleteMany({ userId: userObjectId }).session(session);
    await ticketModel.deleteMany({ userId: userObjectId }).session(session);
    await notificationModel.deleteMany({ userId: userObjectId }).session(session);
    await orderModel.deleteMany({ userId: userObjectId }).session(session);

    if (user.guestLeadId) {
      await leadModel.updateOne(
        { _id: user.guestLeadId },
        { $set: { guestUserId: null } }
      ).session(session);
    }

    await userModel.deleteOne({ _id: userObjectId }).session(session);

    await session.commitTransaction();
    return { deleted: true };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    await session.endSession();
  }
};

module.exports = {
  buildGuestDeletePlan,
  executeGuestCascadeDelete,
  hasActiveChessGame,
};
