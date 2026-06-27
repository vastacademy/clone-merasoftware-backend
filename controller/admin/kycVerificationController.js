// FileName: controller/admin/kycVerificationController.js
const userModel = require("../../models/userModel");

// Helper function to send notifications (placeholder for now)
const sendKycNotification = async (userId, status, reasons = []) => {
    console.log(`Sending KYC notification to user ${userId}: Status - ${status}, Reasons - ${reasons.join(', ')}`);
};

async function getAllKycSubmissions(req, res) {
    try {
        // Check if current user is admin by checking their roles array
        const currentUser = await userModel.findById(req.userId);
        if (!currentUser || !currentUser.roles.includes('admin')) {
            throw new Error("Unauthorized access. Admin privileges required.");
        }

        const kycSubmissions = await userModel.find({
            'userDetails.isDetailsCompleted': true,
            'roles': 'partner'
        }).select('name email phone createdAt userDetails.address userDetails.kycDocuments userDetails.kycStatus userDetails.kycRejectionReasons userDetails.kycApprovedAt userDetails.kycRejectedAt');

        res.status(200).json({
            data: kycSubmissions,
            success: true,
            error: false,
            message: "KYC submissions fetched successfully!"
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

async function approveKyc(req, res) {
    try {
        const { userId } = req.body;

        // Check if current user is admin
        const currentUser = await userModel.findById(req.userId);
        if (!currentUser || !currentUser.roles.includes('admin')) {
            throw new Error("Unauthorized access. Admin privileges required.");
        }

        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found.");
        }

        if (user.userDetails.kycStatus === 'approved') {
            throw new Error("KYC is already approved for this user.");
        }

        user.userDetails.kycStatus = 'approved';
        user.userDetails.kycApprovedAt = new Date();
        user.userDetails.kycRejectionReasons = [];
        user.userDetails.kycRejectedAt = null;
        user.userDetails.kycAdminNotes = "KYC approved by admin.";

        await user.save();

        await sendKycNotification(userId, 'approved');

        res.status(200).json({
            success: true,
            error: false,
            message: "KYC approved successfully!",
            data: {
                userId: user._id,
                kycStatus: user.userDetails.kycStatus,
                kycApprovedAt: user.userDetails.kycApprovedAt
            }
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

async function rejectKyc(req, res) {
    try {
        const { userId, reasons, adminNotes } = req.body;

        // Check if current user is admin
        const currentUser = await userModel.findById(req.userId);
        if (!currentUser || !currentUser.roles.includes('admin')) {
            throw new Error("Unauthorized access. Admin privileges required.");
        }

        if (!reasons || reasons.length === 0) {
            throw new Error("Rejection reasons are required.");
        }

        const user = await userModel.findById(userId);
        if (!user) {
            throw new Error("User not found.");
        }

        if (user.userDetails.kycStatus === 'rejected') {
            throw new Error("KYC is already rejected for this user.");
        }

        user.userDetails.kycStatus = 'rejected';
        user.userDetails.kycRejectedAt = new Date();
        user.userDetails.kycRejectionReasons = reasons;
        user.userDetails.kycApprovedAt = null;
        user.userDetails.kycAdminNotes = adminNotes || "KYC rejected by admin.";

        await user.save();

        await sendKycNotification(userId, 'rejected', reasons);

        res.status(200).json({
            success: true,
            error: false,
            message: "KYC rejected successfully! User notified for resubmission.",
            data: {
                userId: user._id,
                kycStatus: user.userDetails.kycStatus,
                kycRejectionReasons: user.userDetails.kycRejectionReasons
            }
        });

    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false,
        });
    }
}

module.exports = {
    getAllKycSubmissions,
    approveKyc,
    rejectKyc
};
