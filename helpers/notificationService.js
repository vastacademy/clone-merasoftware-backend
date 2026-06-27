const notificationModel = require('../models/notificationModel');
const userModel = require('../models/userModel');
const mongoose = require('mongoose');

/**
 * Create a new notification
 * @param {Object} data - Notification data
 * @returns {Promise<Object>} - Created notification
 */
const createNotification = async (data) => {
  try {
    const notification = new notificationModel(data);
    await notification.save();
    console.log(`Notification created for user ${data.userId}, type: ${data.type}`);
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

/**
 * Create notifications for all admin users
 * @param {Object} updateRequest - The update request object
 * @returns {Promise<Array>} - Created notifications
 */
const createUpdateRequestNotification = async (updateRequest) => {
  try {
    console.log('Creating update request notifications for admins');
    
    // Find admin user IDs
    const adminUsers = await userModel.find({ role: 'ADMIN' }).select('_id');
    
    if (!adminUsers || adminUsers.length === 0) {
      console.warn('No admin users found for notifications');
      return [];
    }
    
    // Create notifications for each admin
    const notifications = [];
    for (const admin of adminUsers) {
      const notification = await createNotification({
        userId: admin._id,
        type: 'update_request',
        title: 'New Update Request',
        message: `${updateRequest.userId.name} has submitted a new website update request.`,
        relatedId: updateRequest._id,
        onModel: 'UpdateRequest',
        isAdmin: true
      });
      notifications.push(notification);
    }
    
    console.log(`Created ${notifications.length} admin notifications`);
    return notifications;
  } catch (error) {
    console.error('Error creating admin notifications:', error);
    throw error;
  }
};

/**
 * Get unread notifications for a user
 * @param {ObjectId} userId - User ID
 * @param {Boolean} isAdmin - Whether to get admin notifications
 * @returns {Promise<Array>} - Notifications
 */
const getUnreadNotifications = async (userId, isAdmin = false) => {
  try {
    const query = { userId };
    
    if (isAdmin !== undefined) {
      query.isAdmin = isAdmin;
    }
    
    return await notificationModel.find(query)
      .sort({ createdAt: -1 })
      .limit(100); // Limit to prevent large query results
  } catch (error) {
    console.error('Error fetching unread notifications:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 * @param {ObjectId} notificationId - Notification ID
 * @returns {Promise<Object>} - Updated notification
 */
const markNotificationAsRead = async (notificationId) => {
  try {
    const notification = await notificationModel.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );
    return notification;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

/**
 * Create notifications for the assigned developer
 * @param {Object} updateRequest - The update request object
 * @returns {Promise<Object>} - Created notification
 */
const createDeveloperNotification = async (updateRequest) => {
  try {
    console.log('Creating notification for assigned developer');
    
    // Check if developer is assigned
    if (!updateRequest.assignedDeveloper) {
      console.warn('No developer assigned to this update request');
      return null;
    }
    
    const notification = await createNotification({
      userId: updateRequest.assignedDeveloper,
      type: 'update_assigned',
      title: 'New Update Assignment',
      message: `You have been assigned a new website update request from ${updateRequest.userId.name}.`,
      relatedId: updateRequest._id,
      onModel: 'UpdateRequest',
      isAdmin: false
    });
    
    console.log(`Created developer notification for ${updateRequest.assignedDeveloper}`);
    return notification;
  } catch (error) {
    console.error('Error creating developer notification:', error);
    throw error;
  }
};

/**
 * Create a purchase notification for user
 * @param {Object} order - The populated order with product details
 * @returns {Promise<Object>} - Created notification
 */
const createPurchaseNotification = async (order) => {
  try {
    console.log('Creating purchase notification for user:', order.userId._id);
    
    // Determine the proper message based on the payment type
    let notificationMessage = '';
    
    if (order.isPartialPayment) {
      notificationMessage = `Your first installment for ${order.productId.serviceName} has been processed successfully.`;
    } else {
      notificationMessage = `Your purchase of ${order.productId.serviceName} has been completed successfully.`;
    }
    
    const notification = await createNotification({
      userId: order.userId._id,
      type: 'purchase',
      title: 'Purchase Confirmation',
      message: notificationMessage,
      relatedId: order._id,
      onModel: 'OrderProduct',
      isAdmin: false
    });
    
    console.log(`Created purchase notification for user ${order.userId._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating purchase notification:', error);
    console.error('Validation errors:', error.errors);
    throw error;
  }
};

/**
 * Create a wallet recharge notification for user
 * @param {Object} user - User object
 * @param {Object} transaction - Transaction details
 * @returns {Promise<Object>} - Created notification
 */
const createWalletRechargeNotification = async (user, transaction) => {
  try {
    console.log('Creating wallet recharge notification for user:', user._id);
    
    const notification = await createNotification({
      userId: user._id,
      type: 'wallet_recharge',
      title: 'Wallet Recharge Successful',
      message: `Your wallet has been recharged with ₹${transaction.amount.toLocaleString()} successfully.`,
      relatedId: transaction._id,
      onModel: 'Transaction',
      isAdmin: false
    });
    
    console.log(`Created wallet recharge notification for user ${user._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating wallet recharge notification:', error);
    throw error;
  }
};

/**
 * Create a payment rejection notification for user
 * @param {Object} user - User object
 * @param {Object} transaction - Transaction details
 * @param {Object} order - Order details if applicable
 * @param {String} rejectionReason - Reason for rejection
 * @returns {Promise<Object>} - Created notification
 */
const createPaymentRejectionNotification = async (user, transaction, order, rejectionReason) => {
  try {
    console.log('Creating payment rejection notification for user:', user._id);
    
    let title, message;
    
    if (order) {
      title = 'Order Payment Rejected';
      message = `Your payment for ${order.productId.serviceName} has been rejected: ${rejectionReason}`;
    } else {
      title = 'Wallet Recharge Rejected';
      message = `Your wallet recharge transaction of ₹${transaction.amount.toLocaleString()} has been rejected: ${rejectionReason}`;
    }
    
    const notification = await createNotification({
      userId: user._id,
      type: 'payment_rejected',
      title: title,
      message: message,
      relatedId: transaction._id,
      onModel: 'Transaction',
      isAdmin: false
    });
    
    console.log(`Created payment rejection notification for user ${user._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating payment rejection notification:', error);
    throw error;
  }
};

/**
 * Create a wallet recharge rejection notification
 * @param {Object} user - User object
 * @param {Object} transaction - Transaction details
 * @param {String} rejectionReason - Reason for rejection
 * @returns {Promise<Object>} - Created notification
 */
const createWalletRechargeRejectionNotification = async (user, transaction, rejectionReason) => {
  // Use the generic payment rejection notification with null order
  return createPaymentRejectionNotification(user, transaction, null, rejectionReason);
};

/**
 * Create a project developer assignment notification for user
 * @param {Object} project - The populated project object
 * @returns {Promise<Object>} - Created notification
 */
const createProjectDeveloperAssignedNotification = async (project) => {
  try {
    console.log('Creating developer assigned notification for user:', project.userId._id);
    
    const notification = await createNotification({
      userId: project.userId._id,
      type: 'project_developer_assigned',
      title: 'Developer Assigned',
      message: `A developer (${project.assignedDeveloper.name}) has been assigned to your website project: ${project.productId.serviceName}.`,
      relatedId: project._id,
      onModel: 'OrderProduct',
      isAdmin: false
    });
    
    console.log(`Created developer assigned notification for user ${project.userId._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating developer assigned notification:', error);
    throw error;
  }
};

/**
 * Create a project assignment notification for developer
 * @param {Object} project - The populated project object
 * @returns {Promise<Object>} - Created notification
 */
const createProjectDeveloperNotification = async (project) => {
  try {
    console.log('Creating project assignment notification for developer:', project.assignedDeveloper._id);
    
    const notification = await createNotification({
      userId: project.assignedDeveloper._id,
      type: 'project_assigned',
      title: 'New Project Assignment',
      message: `You have been assigned to a new website project: ${project.productId.serviceName} for client ${project.userId.name}.`,
      relatedId: project._id,
      onModel: 'OrderProduct',
      isAdmin: false
    });
    
    console.log(`Created project assignment notification for developer ${project.assignedDeveloper._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating project assignment notification:', error);
    throw error;
  }
};

/**
 * Create a project update notification for user
 * @param {Object} project - The project object
 * @param {String} message - Notification message
 * @returns {Promise<Object>} - Created notification
 */
const createProjectUpdateNotification = async (project, message) => {
  try {
    console.log('Creating project update notification for user:', project.userId._id);
    
    const notification = await createNotification({
      userId: project.userId._id,
      type: 'project_update',
      title: 'Project Milestone Completed',
      message: message,
      relatedId: project._id,
      onModel: 'OrderProduct',
      isAdmin: false
    });
    
    console.log(`Created project update notification for user ${project.userId._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating project update notification:', error);
    throw error;
  }
};

/**
 * Create a project message notification for user
 * @param {Object} project - The project object
 * @param {String} message - Message text
 * @returns {Promise<Object>} - Created notification
 */
const createProjectMessageNotification = async (project, message) => {
  try {
    console.log('Creating project message notification for user:', project.userId._id);
    
    const notification = await createNotification({
      userId: project.userId._id,
      type: 'project_message',
      title: 'New Project Message',
      message: `New message about ${project.productId.serviceName}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}`,
      relatedId: project._id,
      onModel: 'OrderProduct',
      isAdmin: false
    });
    
    console.log(`Created project message notification for user ${project.userId._id}`);
    return notification;
  } catch (error) {
    console.error('Error creating project message notification:', error);
    throw error;
  }
};

module.exports = {
  createNotification,
  createUpdateRequestNotification,
  createDeveloperNotification, 
  getUnreadNotifications,
  markNotificationAsRead,
   // New exports
   createPurchaseNotification,
   // New exports
  createWalletRechargeNotification,
  createPaymentRejectionNotification,
  createWalletRechargeRejectionNotification,
  createProjectDeveloperAssignedNotification,
  createProjectDeveloperNotification,
  createProjectUpdateNotification,
  createProjectMessageNotification
};