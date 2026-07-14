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
const updateUserProfileController = require('../controller/user/updateUserProfileController')
const createOrder = require('../controller/order/createOrder')
const getUserOrders = require('../controller/order/getUserOrder')
const getOrderDetails = require('../controller/order/getOrderDetails')
const getCompatibleFeaturesController = require('../controller/product/getCompatibleFeatures')
const getGuestSlidesController = require('../controller/welcomeBanner/getGuestSlidesController')
const uploadGuestSlidesController = require('../controller/welcomeBanner/uploadGuestSlidesController')
const getUserWelcomeController = require('../controller/welcomeBanner/getUserWelcomeController')
const uploadUserWelcomeController = require('../controller/welcomeBanner/uploadUserWelcomeController')
const validateUpdatePlan = require('../controller/order/validateUpdatePlan')
const toggleUpdatePlan = require('../controller/order/toggleUpdatePlan')
const renewMonthlyPlan = require('../controller/order/renewMonthlyPlan')
const { getUserRenewalStatus, manualRenewalCheck } = require('../controller/order/checkRenewalStatus')
const updateGuestSlidesController = require('../controller/welcomeBanner/updateGuestSlidesController')
const updateUserWelcomeController = require('../controller/welcomeBanner/updateUserWelcomeController')
const deleteUserWelcomeController = require('../controller/welcomeBanner/deleteUserWelcomeController')
const deleteGuestSlidesController = require('../controller/welcomeBanner/deleteGuestSlidesController')
const getUserUpdatePlans = require('../controller/user/getUserUpdatePlans');
const submitUpdateRequest = require('../controller/user/submitUpdateRequest');
const getUserUpdateRequests = require('../controller/user/getUserUpdateRequests');
const verifyPaymentController = require('../controller/user/verifyPaymentController');
const getWalletHistory = require('../controller/user/getWalletHistory');
const validateCoupon = require('../controller/user/validateCoupon');
const payInstallment = require('../controller/user/payInstallment');
const getUserNotifications = require('../controller/user/getUserNotificationsController');
const verifyOtpController = require('../controller/user/verifyOtpController');
const resendOtpController = require('../controller/user/resendOtpController');
const downloadInvoice = require('../controller/user/downloadInvoice');
const submitContact = require('../controller/user/contactController');
const arrangeCallBack = require('../controller/user/arrangeCallBack');
const createTicketController = require('../controller/user/createTicketController');
const getUserTicketsController = require('../controller/user/getUserTicketsController');
const getTicketDetailsController = require('../controller/user/getTicketDetailsController');
const replyTicketController = require('../controller/user/replyTicketController');
const getGeneralUsers = require('../controller/user/getGeneralUsers');
const getAdminClients = require('../controller/user/getAdminClients');
const getAdminUserWorkspace = require('../controller/user/getAdminUserWorkspace');
const deleteOrderController = require('../controller/order/deleteOrder');
const scanDeleteOrderController = require('../controller/order/scanDeleteOrder');
const hideProductController = require('../controller/product/hideProduct');
const unhideProductController = require('../controller/product/unhideProduct');
const getHiddenProductsController = require('../controller/product/getHiddenProducts');
const getAllProductsController = require('../controller/product/getAllProducts');
const completeUserDetailsController = require('../controller/user/completeUserDetailsController');
const updatePartnerCustomer = require('../controller/user/updatePartnerCustomer');
const { addBankAccount, updateBankAccount, deleteBankAccount, getBankAccounts } = require('../controller/user/bankAccountController');
const getUserKycStatusController = require('../controller/user/getUserKycStatusController');

// New renewal system controllers
const createRenewalOrder = require('../controller/order/createRenewalOrder');
const checkPendingRenewal = require('../controller/order/checkPendingRenewal');

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
router.get("/admin/clients", authToken, getAdminClients);
router.get("/admin/user-workspace", authToken, getAdminUserWorkspace);
router.get("/admin/delete-order/:orderId/scan", authToken, scanDeleteOrderController);
router.delete("/admin/delete-order/:orderId", authToken, deleteOrderController);
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

router.get("/wallet/history", authToken, getWalletHistory)
router.post("/wallet/verify-payment", authToken, verifyPaymentController)

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

module.exports = router;
