const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const {
  registerConnection,
  createRoom,
  joinRoom,
  enqueueForRandomMatch,
  getRoom,
  getPlayerColor,
  getActiveGamesForUser,
  saveMove,
  resetGame,
  handleDisconnect
} = require('./chessRoomManager');
const { applyMove, undoLastMove } = require('./chessGameLogic');

function roomStatePayload(game) {
  return {
    roomCode: game.roomCode,
    board: game.board,
    turn: game.turn,
    players: game.players,
    status: game.status,
    resetRequestedBy: game.resetRequestedBy,
    paletteKey: game.paletteKey
  };
}

function initChessSocket(server, allowedOrigins) {
  const io = new Server(server, {
    path: '/chess-socket',
    cors: {
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        const normalisedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.includes(normalisedOrigin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true
    }
  });

  const chessNamespace = io.of('/chess');

  chessNamespace.use((socket, next) => {
    try {
      const cookieHeader = socket.handshake.headers.cookie;
      const parsedCookies = cookieHeader ? cookie.parse(cookieHeader) : {};
      const token = parsedCookies.token;

      if (!token) {
        return next(new Error('Please login to play'));
      }

      jwt.verify(token, process.env.TOKEN_SECRET_KEY, (err, decoded) => {
        if (err || !decoded?._id) {
          return next(new Error('Invalid session, please login again'));
        }
        socket.userId = String(decoded._id);
        next();
      });
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  chessNamespace.on('connection', (socket) => {
    registerConnection(socket.id, socket.userId);

    socket.on('chess:getMyGames', async () => {
      try {
        const games = await getActiveGamesForUser(socket.userId);
        socket.emit('chess:myGames', {
          games: games.map((game) => ({
            roomCode: game.roomCode,
            turn: game.turn,
            status: game.status,
            updatedAt: game.updatedAt,
            color: getPlayerColor(game, socket.userId)
          }))
        });
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not load your games' });
      }
    });

    socket.on('chess:createRoom', async ({ color, paletteKey }) => {
      try {
        const creatorColor = color === 'black' ? 'black' : 'white';
        const game = await createRoom(socket.userId, creatorColor, paletteKey);
        socket.join(game.roomCode);
        socket.emit('chess:roomCreated', {
          assignedColor: creatorColor,
          ...roomStatePayload(game)
        });
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not create room' });
      }
    });

    socket.on('chess:joinRoom', async ({ roomCode }) => {
      try {
        const result = await joinRoom(roomCode, socket.userId);
        if (!result.ok) {
          socket.emit('chess:error', { error: result.error });
          return;
        }

        socket.join(result.game.roomCode);
        socket.emit('chess:joined', {
          assignedColor: result.assignedColor,
          ...roomStatePayload(result.game)
        });
        chessNamespace.to(result.game.roomCode).emit('chess:opponentJoined', roomStatePayload(result.game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not join room' });
      }
    });

    socket.on('chess:findRandomMatch', async () => {
      try {
        const result = await enqueueForRandomMatch(socket.userId);

        if (!result.matched) {
          socket.emit('chess:waitingForMatch');
          return;
        }

        socket.join(result.game.roomCode);

        const creatorSocket = [...chessNamespace.sockets.values()]
          .find((s) => s.userId === result.creatorUserId);
        creatorSocket?.join(result.game.roomCode);
        creatorSocket?.emit('chess:roomCreated', {
          assignedColor: result.creatorColor,
          ...roomStatePayload(result.game)
        });

        socket.emit('chess:joined', {
          assignedColor: result.joinedColor,
          ...roomStatePayload(result.game)
        });

        chessNamespace.to(result.game.roomCode).emit('chess:opponentJoined', roomStatePayload(result.game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not find a match' });
      }
    });

    socket.on('chess:move', async ({ roomCode, from, to }) => {
      try {
        const game = await getRoom(roomCode);
        if (!game) {
          socket.emit('chess:error', { error: 'Room not found' });
          return;
        }

        const playerColor = getPlayerColor(game, socket.userId);
        if (!playerColor) {
          socket.emit('chess:error', { error: 'You are not a player in this room' });
          return;
        }

        const result = applyMove(game, { from, to }, playerColor);
        if (!result.ok) {
          socket.emit('chess:error', { error: result.error });
          return;
        }

        await saveMove(game);
        chessNamespace.to(roomCode).emit('chess:state', roomStatePayload(game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not apply move' });
      }
    });

    socket.on('chess:undo', async ({ roomCode }) => {
      try {
        const game = await getRoom(roomCode);
        if (!game) {
          socket.emit('chess:error', { error: 'Room not found' });
          return;
        }

        const playerColor = getPlayerColor(game, socket.userId);
        if (!playerColor) {
          socket.emit('chess:error', { error: 'You are not a player in this room' });
          return;
        }

        const result = undoLastMove(game);
        if (!result.ok) {
          socket.emit('chess:error', { error: result.error });
          return;
        }

        await saveMove(game);
        chessNamespace.to(roomCode).emit('chess:state', roomStatePayload(game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not undo move' });
      }
    });

    socket.on('chess:requestReset', async ({ roomCode }) => {
      try {
        const game = await getRoom(roomCode);
        if (!game) {
          socket.emit('chess:error', { error: 'Room not found' });
          return;
        }

        const playerColor = getPlayerColor(game, socket.userId);
        if (!playerColor) {
          socket.emit('chess:error', { error: 'You are not a player in this room' });
          return;
        }

        game.status = 'reset-pending';
        game.resetRequestedBy = socket.userId;
        await game.save();

        chessNamespace.to(roomCode).emit('chess:state', roomStatePayload(game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not request reset' });
      }
    });

    socket.on('chess:respondReset', async ({ roomCode, accept }) => {
      try {
        const game = await getRoom(roomCode);
        if (!game) {
          socket.emit('chess:error', { error: 'Room not found' });
          return;
        }

        const playerColor = getPlayerColor(game, socket.userId);
        if (!playerColor) {
          socket.emit('chess:error', { error: 'You are not a player in this room' });
          return;
        }

        if (game.status !== 'reset-pending') {
          socket.emit('chess:error', { error: 'No reset request pending' });
          return;
        }

        if (String(game.resetRequestedBy) === socket.userId) {
          socket.emit('chess:error', { error: 'Waiting for the other player to respond' });
          return;
        }

        if (accept) {
          await resetGame(game);
        } else {
          game.status = 'active';
          game.resetRequestedBy = null;
          await game.save();
        }

        chessNamespace.to(roomCode).emit('chess:state', roomStatePayload(game));
      } catch (err) {
        socket.emit('chess:error', { error: 'Could not respond to reset request' });
      }
    });

    socket.on('disconnect', () => {
      const result = handleDisconnect(socket.id);
      if (result) {
        chessNamespace.to(result.roomCode).emit('chess:opponentLeft', {});
      }
    });
  });

  return io;
}

module.exports = { initChessSocket };
