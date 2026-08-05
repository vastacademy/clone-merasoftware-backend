const ChessGame = require('./chessGameModel');
const { createGameState, createInitialBoard } = require('./chessGameLogic');

const waitingQueue = [];
const socketToUser = new Map();
const userToSocket = new Map();
const socketToRoom = new Map();

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function generateUniqueRoomCode() {
  let code = generateRoomCode();
  while (await ChessGame.exists({ roomCode: code })) {
    code = generateRoomCode();
  }
  return code;
}

function registerConnection(socketId, userId) {
  socketToUser.set(socketId, userId);
  userToSocket.set(userId, socketId);
}

async function createRoom(userId, creatorColor, paletteKey) {
  const roomCode = await generateUniqueRoomCode();
  const initialState = createGameState();

  const game = await ChessGame.create({
    roomCode,
    players: { [creatorColor]: userId },
    board: initialState.board,
    turn: initialState.turn,
    history: [],
    paletteKey: paletteKey || 'classicGreen'
  });

  socketToRoom.set(userToSocket.get(String(userId)), roomCode);
  return game;
}

async function joinRoom(roomCode, userId) {
  const game = await ChessGame.findOne({ roomCode });
  if (!game) {
    return { ok: false, error: 'Room not found' };
  }

  const alreadyInRoom = String(game.players.white) === String(userId) || String(game.players.black) === String(userId);
  if (alreadyInRoom) {
    const assignedColor = String(game.players.white) === String(userId) ? 'white' : 'black';
    socketToRoom.set(userToSocket.get(String(userId)), roomCode);
    return { ok: true, game, assignedColor };
  }

  const openColor = !game.players.white ? 'white' : (!game.players.black ? 'black' : null);
  if (!openColor) {
    return { ok: false, error: 'Room is already full' };
  }

  game.players[openColor] = userId;
  await game.save();

  socketToRoom.set(userToSocket.get(String(userId)), roomCode);
  return { ok: true, game, assignedColor: openColor };
}

async function enqueueForRandomMatch(userId) {
  const socketId = userToSocket.get(String(userId));

  while (waitingQueue.length > 0) {
    const opponentUserId = waitingQueue.shift();
    if (opponentUserId === String(userId)) continue;
    if (!userToSocket.has(opponentUserId)) continue;

    const creatorColor = Math.random() < 0.5 ? 'white' : 'black';
    const game = await createRoom(opponentUserId, creatorColor);
    const joinResult = await joinRoom(game.roomCode, userId);

    return {
      matched: true,
      game: joinResult.game,
      creatorUserId: opponentUserId,
      creatorColor,
      joinedColor: joinResult.assignedColor
    };
  }

  waitingQueue.push(String(userId));
  return { matched: false };
}

function removeFromQueue(userId) {
  const index = waitingQueue.indexOf(String(userId));
  if (index !== -1) {
    waitingQueue.splice(index, 1);
  }
}

async function getRoom(roomCode) {
  return ChessGame.findOne({ roomCode });
}

function getPlayerColor(game, userId) {
  const whiteId = game.players.white?._id || game.players.white;
  const blackId = game.players.black?._id || game.players.black;
  if (whiteId && String(whiteId) === String(userId)) return 'white';
  if (blackId && String(blackId) === String(userId)) return 'black';
  return null;
}

async function getActiveGamesForUser(userId) {
  return ChessGame.find({
    status: { $ne: 'closed' },
    $or: [{ 'players.white': userId }, { 'players.black': userId }]
  })
    .sort({ updatedAt: -1 })
    .populate('players.white players.black', 'name email');
}

async function saveMove(game) {
  game.markModified('board');
  game.markModified('history');
  await game.save();
}

async function resetGame(game) {
  game.board = createInitialBoard();
  game.turn = 'white';
  game.history = [];
  game.status = 'active';
  game.resetRequestedBy = null;
  game.markModified('board');
  game.markModified('history');
  await game.save();
}

async function deleteGame(roomCode) {
  await ChessGame.deleteOne({ roomCode });
}

async function expireStaleEndRequests(olderThanHours) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const staleGames = await ChessGame.find({
    status: 'end-pending',
    endRequestedAt: { $lte: cutoff }
  });

  if (staleGames.length === 0) return 0;

  await ChessGame.deleteMany({
    _id: { $in: staleGames.map((game) => game._id) }
  });

  return staleGames.length;
}

function handleDisconnect(socketId) {
  const userId = socketToUser.get(socketId);
  socketToUser.delete(socketId);
  if (userId) {
    userToSocket.delete(userId);
    removeFromQueue(userId);
  }

  const roomCode = socketToRoom.get(socketId);
  socketToRoom.delete(socketId);
  if (!roomCode) return null;

  return { roomCode };
}

module.exports = {
  registerConnection,
  createRoom,
  joinRoom,
  enqueueForRandomMatch,
  removeFromQueue,
  getRoom,
  getPlayerColor,
  getActiveGamesForUser,
  saveMove,
  resetGame,
  deleteGame,
  expireStaleEndRequests,
  handleDisconnect
};
