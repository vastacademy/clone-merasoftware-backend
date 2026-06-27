const { processAutoRenewal } = require('../../cron/autoRenewalCron');

// TEMPORARY CONTROLLER - FOR TESTING ONLY
// DELETE THIS AFTER TESTING IS COMPLETE

const testAutoRenewalController = async (req, res) => {
    try {
        console.log('🧪 Manual test trigger for auto-renewal process...');

        // Run the auto-renewal process
        await processAutoRenewal();

        res.status(200).json({
            success: true,
            message: 'Auto-renewal process completed successfully. Check console logs and database for results.',
            note: 'This is a test endpoint. Remove after testing.'
        });
    } catch (error) {
        console.error('Error in test auto-renewal:', error);
        res.status(500).json({
            success: false,
            message: error.message,
            error: error
        });
    }
};

module.exports = testAutoRenewalController;
