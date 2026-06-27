const uploadProductPermission = require("../../helpers/permission");
const orderModel = require("../../models/orderProductModel");

async function updatePlanProgressController(req, res) {
    try {
        // Check permission
        const sessionUserId = req.userId;
        if (!await uploadProductPermission(sessionUserId)) {
            throw new Error("Permission denied");
        }

        const { planId, updateNumber, completed } = req.body;

        // Validate input
        if (!planId) {
            throw new Error("Plan ID is required");
        }

        if (!updateNumber) {
            throw new Error("Update number is required");
        }

        // Fetch the plan
        const plan = await orderModel.findById(planId)
            .populate('userId', 'name email')
            .populate('productId');

        if (!plan) {
            throw new Error("Update plan not found");
        }

        // Verify it's an update plan
        if (plan.productId?.category !== 'website_updates') {
            throw new Error("This order is not a website update plan");
        }

        // Validate update number
        const totalUpdates = plan.productId.updateCount || 0;
        const currentUsedUpdates = plan.updatesUsed || 0;

        if (updateNumber > totalUpdates) {
            throw new Error(`Update number exceeds total available updates (${totalUpdates})`);
        }

        if (updateNumber <= currentUsedUpdates) {
            throw new Error(`Update #${updateNumber} has already been used`);
        }

        if (updateNumber !== currentUsedUpdates + 1) {
            throw new Error(`Updates must be used in sequence. Next update should be #${currentUsedUpdates + 1}`);
        }

        // Check if the plan is still active (within validity period)
        const validityInDays = plan.productId.validityPeriod;
        const startDate = new Date(plan.createdAt);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + validityInDays);
        
        const today = new Date();
        if (today > endDate) {
            throw new Error("Update plan has expired");
        }

        // Update the plan's used updates count
        plan.updatesUsed = updateNumber;

        // If all updates are used, mark the plan as inactive
        if (plan.updatesUsed >= totalUpdates) {
            plan.isActive = false;
        }

        // Save the updated plan
        await plan.save();

        // Get the io instance from req (added by middleware)
        const io = req.io;
        
        // Emit update to the specific user
        if (io) {
            io.to(`user_${plan.userId._id}`).emit('planUpdate', {
                planId: plan._id,
                data: {
                    messages: plan.messages,
                    updatesUsed: plan.updatesUsed,
                    isActive: plan.isActive
                }
            });
        }

        res.status(200).json({
            message: `Update #${updateNumber} completed successfully`,
            error: false,
            success: true,
            data: plan
        });
    } catch (err) {
        res.status(400).json({
            message: err.message || err,
            error: true,
            success: false
        });
    }
}

module.exports = updatePlanProgressController;