const cron = require('node-cron');
const { expireStaleEndRequests } = require('./chessRoomManager');

const STALE_END_REQUEST_HOURS = 12;

function scheduleChessCleanup() {
  cron.schedule('0 */2 * * *', async () => {
    try {
      const deletedCount = await expireStaleEndRequests(STALE_END_REQUEST_HOURS);
      if (deletedCount > 0) {
        console.log(`Chess cleanup: deleted ${deletedCount} game(s) with an unanswered end request older than ${STALE_END_REQUEST_HOURS}h`);
      }
    } catch (err) {
      console.error('Chess cleanup cron failed:', err.message);
    }
  });
}

module.exports = { scheduleChessCleanup };
