const express = require('express')

const router = express.Router()
const multer = require('multer');
const path = require('path');
// const fs = require('fs');

const userSignUpController = require("../controller/user/userSignUp")
const userSignInController = require("../controller/user/userSignIn")
const userRoleSwitchController = require("../controller/user/userRoleSwitch")
const userDetailsController = require('../controller/user/userDetails')
const addRoleToUserController = require('../controller/user/addRoleToUser')
const authToken = require('../middleware/authToken')
const userLogout = require('../controller/user/userLogout')
const allUsers = require('../controller/user/allUsers')
const getPartnerCustomers = require('../controller/user/partnerCustomers')
const updateUser = require('../controller/user/updateUser')
const UploadProductController = require('../controller/product/uploadPoduct')
const getProductController = require('../controller/product/getProduct')
const updateProductController = require('../controller/product/updateProduct')
const getCategoryProduct = require('../controller/product/getCategoryProductOne')
const getCategoryWiseProduct = require('../controller/product/getCategoryWiseProduct')
const getProductDetails = require('../controller/product/getProductDetails')
const addToCartController = require('../controller/user/addToCartController')
const countAddToCartProduct = require('../controller/user/countAddToCartProduct')
const addToCartViewProduct = require('../controller/user/addToCartViewProduct')
const updateAddToCartProduct = require('../controller/user/updateAddToCartProduct')
const deleteAddToCartProduct = require('../controller/user/deleteAddToCartProduct')
const searchProduct = require('../controller/product/searchProduct')
const filterProductController = require('../controller/product/filterProduct')
const paymentController = require('../controller/order/paymentController')
const orderController = require('../controller/order/order.controller')
const allOrderController = require('../controller/order/allOrder.controller')
const UploadCategoryController = require('../controller/product/uploadCategory')
const getCategoryController = require('../controller/product/getCategories')
const updateCategoryController = require('../controller/product/updateCategory')
const deleteProductController = require('../controller/product/deleteProduct')
const UploadAdController = require('../controller/ads/uploadAd')
const UploadBannerController = require('../controller/ads/uploadBanner')
const getBannersController = require('../controller/ads/getBanner')
const updateBannerController = require('../controller/ads/updateBanner')
const DeleteBannerController = require('../controller/ads/deleteBanner')
const DeleteCategoryController = require('../controller/product/deleteCategory')
const addWalletBalanceController = require('../controller/admin/addWalletBalanceController')
const getWalletBalanceController = require('../controller/admin/getWalletBalanceController')
const deductWalletController = require('../controller/admin/deductWalletController ')
const updateUserProfileController = require('../controller/user/updateUserProfileController')
const uploadDeveloperController = require('../controller/admin/uploadDeveloper')
const getAllDevelopersController = require('../controller/admin/getDeveloper')
const createOrder = require('../controller/order/createOrder')
const getUserOrders = require('../controller/order/getUserOrder')
const getOrderDetails = require('../controller/order/getOrderDetails')
const getProjectsController = require('../controller/admin/getProjectController')
const updateProgressController = require('../controller/admin/updateProgressController')
const sendMessageController = require('../controller/admin/sendMessageController')
const getWalletHistoryController = require('../controller/admin/getWalletHistoryController')
const getCompatibleFeaturesController = require('../controller/product/getCompatibleFeatures')
const getGuestSlidesController = require('../controller/welcomeBanner/getGuestSlidesController')
const uploadGuestSlidesController = require('../controller/welcomeBanner/uploadGuestSlidesController')
const getUserWelcomeController = require('../controller/welcomeBanner/getUserWelcomeController')
const uploadUserWelcomeController = require('../controller/welcomeBanner/uploadUserWelcomeController')
const adminDeleteOrderController = require('../controller/admin/deleteOrderController')
const validateUpdatePlan = require('../controller/order/validateUpdatePlan')
const toggleUpdatePlan = require('../controller/order/toggleUpdatePlan')
const renewMonthlyPlan = require('../controller/order/renewMonthlyPlan')
const { getUserRenewalStatus, manualRenewalCheck } = require('../controller/order/checkRenewalStatus')
const editDeveloperController = require('../controller/admin/editDeveloperController')
const updateGuestSlidesController = require('../controller/welcomeBanner/updateGuestSlidesController')
const updateUserWelcomeController = require('../controller/welcomeBanner/updateUserWelcomeController')
const deleteUserWelcomeController = require('../controller/welcomeBanner/deleteUserWelcomeController')
const deleteGuestSlidesController = require('../controller/welcomeBanner/deleteGuestSlidesController')
const updatePlanProgressController = require('../controller/admin/updatePlanProgressController')
const adminUpdatePlansController = require('../controller/admin/adminUpdatePlansController')
const assignDeveloperController = require('../controller/admin/assignDeveloperController')
const getSingleDeveloperController = require('../controller/admin/getSingleDeveloperController')
const getUserUpdatePlans = require('../controller/user/getUserUpdatePlans');
const submitUpdateRequest = require('../controller/user/submitUpdateRequest');
const getUserUpdateRequests = require('../controller/user/getUserUpdateRequests');
const getAllUpdateRequests = require('../controller/admin/getAllUpdateRequests');
const assignUpdateRequestDeveloper = require('../controller/admin/assignUpdateRequestDeveloper');
const sendUpdateRequestMessage = require('../controller/admin/sendUpdateRequestMessage');
const completeUpdateRequest = require('../controller/admin/completeUpdateRequest');
const rejectUpdateRequest = require('../controller/admin/rejectUpdateRequest');
const getAssignedUpdates = require('../controller/developer/getAssignedUpdates');
const sendUpdateMessage = require('../controller/developer/sendUpdateMessage');
const addDeveloperNote = require('../controller/developer/addDeveloperNote');
const completeUpdate = require('../controller/developer/completeUpdate');
const { updateFileSettings, getFileSettings } = require('../controller/admin/updateFileSettingsController');
const downloadAllFiles = require('../controller/admin/downloadAllFiles');
const getPendingTransactionsController = require('../controller/admin/getPendingTransactionsController');
const approveTransactionController = require('../controller/admin/approveTransactionController');
const rejectTransactionController = require('../controller/admin/rejectTransactionController');
const verifyPaymentController = require('../controller/user/verifyPaymentController');
const validateCoupon = require('../controller/user/validateCoupon');
const getAllCoupons = require('../controller/admin/getAllCoupons');
const createCoupon = require('../controller/admin/createCoupon');
const updateCoupon = require('../controller/admin/updateCoupon');
const deleteCoupon = require('../controller/admin/deleteCoupon');
const getProductsForCoupon = require('../controller/admin/getProductsForCoupon');
const adminTransactionHistoryController = require('../controller/admin/adminTransactionHistoryController');
const payInstallment = require('../controller/user/payInstallment');
const markInstallmentVerificationPending = require('../controller/admin/markInstallmentVerificationPending');
const checkPendingOrderTransactions = require('../controller/admin/checkPendingOrderTransactions');
const getAdminNotifications = require('../controller/admin/getNotificationsController');
const getUserNotifications = require('../controller/user/getUserNotificationsController');
const markNotificationRead = require('../controller/admin/markNotificationReadController');
const getDeveloperNotifications = require('../controller/developer/getDeveloperNotification');
const verifyOtpController = require('../controller/user/verifyOtpController');
const resendOtpController = require('../controller/user/resendOtpController');
const getPendingOrders = require('../controller/admin/getPendingOrders');
const approveOrder = require('../controller/admin/approveOrder');
const rejectOrder = require('../controller/admin/rejectOrder');
const downloadInvoice = require('../controller/user/downloadInvoice');
const submitContact = require('../controller/user/contactController');
const arrangeCallBack = require('../controller/user/arrangeCallBack');
const createTicketController = require('../controller/user/createTicketController');
const getUserTicketsController = require('../controller/user/getUserTicketsController');
const getTicketDetailsController = require('../controller/user/getTicketDetailsController');
const replyTicketController = require('../controller/user/replyTicketController');
const closeTicketController = require('../controller/admin/closeTicketController');
const getAllTicketsController = require('../controller/admin/getAllTicketsController');
const updateProjectLinkController = require('../controller/admin/updateProjectLinkController');
const getGeneralUsers = require('../controller/user/getGeneralUsers');
const hideProductController = require('../controller/product/hideProduct');
const unhideProductController = require('../controller/product/unhideProduct');
const getHiddenProductsController = require('../controller/product/getHiddenProducts');
const getAllProductsController = require('../controller/product/getAllProducts');
const { getBusinessCreated } = require('../controller/partner/businessCreatedController');
const { getFirstPurchaseList } = require('../controller/partner/firstPurchaseListController');
const { getFirstPurchaseSummary } = require('../controller/partner/firstPurchaseSummaryController');
const completeUserDetailsController = require('../controller/user/completeUserDetailsController');
const getCommissionHistory = require('../controller/partner/getCommissionHistory');
const getWalletSummary = require('../controller/partner/getWalletSummary');
const requestWithdrawal = require('../controller/partner/requestWithdrawal');
const getWithdrawalHistory = require('../controller/partner/getWithdrawalHistory');
const getWithdrawalRequests = require('../controller/admin/getWithdrawalRequests');
const approveWithdrawal = require('../controller/admin/approveWithdrawal');
const rejectWithdrawal = require('../controller/admin/rejectWithdrawal');
const updatePartnerCustomer = require('../controller/user/updatePartnerCustomer');
const { getPendingVerifications } = require('../controller/admin/getPendingVerifications');
const deleteTransactionController = require('../controller/admin/deleteTransactionController');
const { addBankAccount, updateBankAccount, deleteBankAccount, getBankAccounts } = require('../controller/user/bankAccountController');
const { getAllKycSubmissions, approveKyc, rejectKyc } = require('../controller/admin/kycVerificationController');
const getUserKycStatusController = require('../controller/user/getUserKycStatusController');

// New renewal system controllers
const createRenewalOrder = require('../controller/order/createRenewalOrder');
const approveRenewalOrder = require('../controller/admin/approveRenewalOrder');
const { getPendingRenewals, rejectRenewalOrder } = require('../controller/admin/getPendingRenewals');
const checkPendingRenewal = require('../controller/order/checkPendingRenewal');

// Monthly invoice controllers
const {
    getAllInvoices,
    getInvoiceById,
    getUserInvoices,
    markInvoiceAsPaid,
    cancelInvoice,
    sendInvoiceReminder,
    getInvoiceStatistics,
    updateOverdueInvoices
} = require('../controller/admin/monthlyInvoiceController');

// TEST ONLY - Remove after testing
const testAutoRenewalController = require('../controller/admin/testAutoRenewalController');
const debugOrderController = require('../controller/admin/debugOrderController');

// Plan closure controllers
const closePlanController = require('../controller/admin/closePlanController');
const getUpdatePlansController = require('../controller/admin/getUpdatePlansController');

const memoryStorage = multer.memoryStorage();

// Configure multer
const upload = multer({
  storage: memoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 20 // Max 20 files
  },
  fileFilter: function(req, file, cb) {
    // Get file extension and mime type
    const ext = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype;
    
    // Allow specific file types
    if (
      ext === '.jpg' || ext === '.jpeg' || 
      ext === '.txt' || ext === '.rtf' || 
      ext === '.pdf' || ext === '.doc' || ext === '.docx'
    ) {
      // Additional MIME type verification
      if (
        mimeType === 'image/jpeg' || 
        mimeType === 'text/plain' || 
        mimeType === 'application/rtf' || 
        mimeType === 'application/pdf' || 
        mimeType === 'application/msword' || 
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type'));
      }
    } else {
      cb(new Error('Only JPG, JPEG, TXT, RTF, PDF, DOC, DOCX files are allowed'));
    }
  }
});

//user
router.post("/signup", userSignUpController);

router.get("/partner-customers", authToken, getPartnerCustomers);
router.post("/signin", userSignInController);
router.get("/general-users", getGeneralUsers);
router.post('/verify-otp', verifyOtpController);
router.post('/resend-otp', resendOtpController);
router.post("/role-switch", authToken, userRoleSwitchController);
router.get("/user-details", authToken, userDetailsController)
router.get("/userLogout", userLogout)
router.post("/update-profile", authToken, updateUserProfileController);
router.post("/complete-profile", authToken, completeUserDetailsController);
router.post("/update-partner-customer/:customerId", authToken, updatePartnerCustomer);

// Add role to user
router.post("/addRole", authToken, addRoleToUserController)
router.get("/user-update-plans", authToken, getUserUpdatePlans)
router.post("/user-request-update", authToken, upload.any(), submitUpdateRequest)
router.get("/get-update-requests", authToken, getUserUpdateRequests)
router.post("/validate-coupon", authToken, validateCoupon)
router.post("/pay-installment", authToken, payInstallment)
router.get("/user-notifications", authToken, getUserNotifications);
router.post("/mark-notification-read", authToken, markNotificationRead);
router.get('/download-invoice/:orderId', authToken, downloadInvoice);
router.post("/contact-us", submitContact);
router.post("/arrange-callback", arrangeCallBack);
router.post("/create-ticket", authToken, createTicketController);
router.get("/get-user-tickets", authToken, getUserTicketsController);
router.get("/get-ticket-details/:ticketId", authToken, getTicketDetailsController);
router.post("/ticket-reply/:ticketId", authToken, replyTicketController);
router.post("/add-bank-account", authToken, addBankAccount);
router.post("/update-bank-account/:accountId", authToken, updateBankAccount);
router.delete("/delete-bank-account/:accountId", authToken, deleteBankAccount);
router.get("/get-bank-accounts", authToken, getBankAccounts);
router.get("/user-kyc-status", authToken, getUserKycStatusController);
router.get("/my-invoices", authToken, getUserInvoices);  // User can view their own invoices

//admin panel
router.get("/all-user", authToken, allUsers)
router.post("/update-user", authToken, updateUser)
router.post("/wallet/add-balance", authToken, addWalletBalanceController)
router.get("/wallet/balance", authToken, getWalletBalanceController)
router.post("/wallet/deduct", authToken, deductWalletController);
router.get("/wallet/history", authToken, getWalletHistoryController)
router.post("/wallet/verify-payment", authToken, verifyPaymentController)
router.get("/wallet/pending-transactions", authToken, getPendingTransactionsController)
router.post("/wallet/approve-transaction", authToken, approveTransactionController)
router.post("/wallet/reject-transaction", authToken, rejectTransactionController)
router.get("/wallet/admin-transaction-history", authToken, adminTransactionHistoryController)
router.delete("/wallet/delete-transaction/:transactionId", authToken, deleteTransactionController);
router.post("/upload-developer", authToken, uploadDeveloperController)
router.get("/get-developer", authToken, getAllDevelopersController)
router.post("/edit-developer/:id", authToken, editDeveloperController)
router.get("/get-projects", authToken, getProjectsController)
router.post("/update-project-progress", authToken, updateProgressController)
router.get("/get-update-plans", authToken, adminUpdatePlansController)
router.post("/update-plan-progress", authToken, updatePlanProgressController)
router.post("/project-message", authToken, sendMessageController)
router.post("/assign-developer", authToken, assignDeveloperController)
router.get("/get-single-developer/:id", getSingleDeveloperController)
router.get("/get-admin-update-requests", authToken, getAllUpdateRequests)
router.post("/assign-update-developer", authToken, assignUpdateRequestDeveloper)
router.post("/update-request-message", authToken, sendUpdateRequestMessage)
router.post("/complete-update-request", authToken, completeUpdateRequest)
router.post("/reject-update-request", authToken, rejectUpdateRequest)
router.post("/update-file-settings", authToken, updateFileSettings);
router.get("/get-file-settings", authToken, getFileSettings);
router.get("/download-all-files/:requestId", downloadAllFiles)
router.get("/get-coupons", authToken, getAllCoupons)
router.post("/create-coupon", authToken, createCoupon)
router.post("/update-coupon/:id", authToken, updateCoupon)
router.delete("/delete-coupon/:id", authToken, deleteCoupon)
router.get("/products-coupon", authToken, getProductsForCoupon)
router.post("/mark-installment-pending", authToken, markInstallmentVerificationPending)
router.get("/check-pending-order-transactions/:orderId", authToken, checkPendingOrderTransactions)
router.get("/admin-notifications", authToken, getAdminNotifications);
router.get('/pending-orders', authToken, getPendingOrders);
router.post('/approve-order/:orderId', authToken, approveOrder);
router.post('/reject-order/:orderId', authToken, rejectOrder);
router.post("/ticket-close/:ticketId", authToken, closeTicketController);
router.get("/get-all-tickets", authToken, getAllTicketsController)
router.post("/update-project-link", authToken, updateProjectLinkController);
router.get("/all-withdrawal-requests", authToken, getWithdrawalRequests);
router.post("/approve-withdrawals/:requestId", authToken, approveWithdrawal);
router.post("/reject-withdrawals/:requestId", authToken, rejectWithdrawal);
router.get("/get-order-payment-verification", authToken, getPendingVerifications);
router.get("/admin-kyc-submissions", authToken, getAllKycSubmissions);
router.post("/admin-kyc-approve", authToken, approveKyc);
router.post("/admin-kyc-reject", authToken, rejectKyc);

// ADMIN: Renewal approval endpoints
router.get("/pending-renewals", authToken, getPendingRenewals);  // View all pending renewals
router.post("/approve-renewal/:transactionId", authToken, approveRenewalOrder);  // Approve renewal
router.post("/reject-renewal/:transactionId", authToken, rejectRenewalOrder);  // Reject renewal

// ADMIN: Monthly Invoice Management
router.get("/invoices", authToken, getAllInvoices);  // Get all invoices with filters
router.get("/invoices/statistics", authToken, getInvoiceStatistics);  // Get invoice statistics
router.get("/invoices/user/:userId", authToken, getUserInvoices);  // Get invoices for a specific user
router.get("/invoices/:invoiceId", authToken, getInvoiceById);  // Get single invoice by ID
router.post("/invoices/:invoiceId/mark-paid", authToken, markInvoiceAsPaid);  // Mark invoice as paid
router.post("/invoices/:invoiceId/cancel", authToken, cancelInvoice);  // Cancel invoice
router.post("/invoices/:invoiceId/send-reminder", authToken, sendInvoiceReminder);  // Send reminder email
router.post("/invoices/update-overdue", authToken, updateOverdueInvoices);  // Update overdue invoices

// 🧪 TEST ROUTES - Remove after testing
router.post("/test-auto-renewal", authToken, testAutoRenewalController);  // Manually trigger auto-renewal for testing
router.get("/debug-orders", authToken, debugOrderController);  // Check which orders are eligible for renewal

// developer
router.get("/assigned-updates", authToken, getAssignedUpdates)
router.post("/developer-update-message", authToken, sendUpdateMessage)
router.post("/developer-add-note", authToken, addDeveloperNote)
router.post("/developer-complete-update", authToken, completeUpdate)
router.get("/developer-notifications", authToken, getDeveloperNotifications)


// Partner
router.get("/business-created", authToken, getBusinessCreated);
router.get("/first-purchase-list", authToken, getFirstPurchaseList);
router.get("/only-first-order", authToken, getFirstPurchaseSummary);
router.get("/get-commission-history", authToken, getCommissionHistory);
router.get("/commission-wallet-summary", authToken, getWalletSummary);
router.post("/request-withdrawal", authToken, requestWithdrawal);
router.get("/get-withdrawal-history", authToken, getWithdrawalHistory);

// product
router.post("/upload-product", authToken, UploadProductController )
router.get("/get-product",getProductController)
router.post("/update-product", authToken, updateProductController)
router.delete("/delete-product", authToken, deleteProductController)
router.get("/get-categoryProduct",getCategoryProduct)
router.post("/category-product",getCategoryWiseProduct)
router.post("/product-details", getProductDetails)
router.get("/search", searchProduct)
router.post("/filter-product", filterProductController)
router.post("/upload-category",authToken, UploadCategoryController)
router.get("/get-categories", getCategoryController)
router.post("/update-category/:id",authToken, updateCategoryController)
router.delete("/delete-category", authToken, DeleteCategoryController)
router.get("/compatible-features", getCompatibleFeaturesController);
router.post("/hide-product", authToken, hideProductController);
router.post("/unhide-product", authToken, unhideProductController);
router.get("/get-hidden-products", authToken, getHiddenProductsController);
router.get("/all-products", authToken, getAllProductsController);

//user add to cart
router.post("/addtocart", authToken, addToCartController)
router.get("/countAddToCartProduct", authToken, countAddToCartProduct)
router.get("/view-card-product", authToken, addToCartViewProduct)
router.post("/update-cart-product", authToken, updateAddToCartProduct)
router.post("/delete-cart-product", authToken, deleteAddToCartProduct)

// payment and order
router.post("/checkout",authToken,paymentController)
router.get("/order-list", authToken, orderController)
router.get("/all-order",authToken, allOrderController)

router.post("/create-order", authToken, createOrder)
router.post("/validate-update-plan", authToken, validateUpdatePlan)
router.post("/toggle-update-plan", authToken, toggleUpdatePlan)

// OLD RENEWAL - DEPRECATED (kept for backward compatibility)
router.post("/renew-monthly-plan", authToken, renewMonthlyPlan)

// NEW RENEWAL SYSTEM (Approval-based flow)
router.post("/create-renewal", authToken, createRenewalOrder)  // User creates renewal request
router.get("/check-pending-renewal", authToken, checkPendingRenewal)  // Check if plan has pending renewal
router.get("/user-renewal-status", authToken, getUserRenewalStatus)
router.post("/manual-renewal-check", authToken, manualRenewalCheck)

router.get("/get-order", authToken, getUserOrders)
router.get("/order-details/:orderId", authToken, getOrderDetails)
router.delete("/delete-order/:orderId", authToken, adminDeleteOrderController)

// ads
router.post("/upload-ad", authToken, UploadAdController)
router.post("/upload-banner", authToken, UploadBannerController)
router.get("/get-banner", getBannersController)
router.post("/update-banner/:id", authToken, updateBannerController)
router.delete("/delete-banner", authToken, DeleteBannerController)

// welcome banner
router.get("/get-guest-slides", getGuestSlidesController)
router.post("/upload-guest-slides", authToken, uploadGuestSlidesController)
router.post("/update-guest-slides/:id", authToken, updateGuestSlidesController)
router.delete("/delete-guest-slides/:id", authToken, deleteGuestSlidesController)

// User Welcome Routes
router.get("/get-user-welcome", getUserWelcomeController)
router.post("/upload-user-welcome", authToken, uploadUserWelcomeController)
router.post("/update-user-welcome/:id", authToken, updateUserWelcomeController)
router.delete("/delete-user-welcome/:id", authToken, deleteUserWelcomeController)

// Plan closure routes
router.post("/admin/close-plan", authToken, closePlanController)
router.get("/admin/get-update-plans", authToken, getUpdatePlansController)

module.exports = router;
