const INITIAL_BOARD = () => {
  const empty = Array.from({ length: 8 }, () => Array(8).fill(null));

  const backRank = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];

  backRank.forEach((type, col) => {
    empty[0][col] = { type, color: 'black' };
    empty[7][col] = { type, color: 'white' };
  });

  for (let col = 0; col < 8; col++) {
    empty[1][col] = { type: 'pawn', color: 'black' };
    empty[6][col] = { type: 'pawn', color: 'white' };
  }

  return empty;
};

function createGameState() {
  return {
    board: INITIAL_BOARD(),
    turn: 'white',
    history: []
  };
}

function isInBounds(pos) {
  return pos && pos.row >= 0 && pos.row < 8 && pos.col >= 0 && pos.col < 8;
}

function applyMove(game, move, playerColor) {
  const { from, to } = move;

  if (!isInBounds(from) || !isInBounds(to)) {
    return { ok: false, error: 'Move is out of bounds' };
  }

  if (game.turn !== playerColor) {
    return { ok: false, error: 'Not your turn' };
  }

  const piece = game.board[from.row][from.col];
  if (!piece) {
    return { ok: false, error: 'No piece at source square' };
  }

  if (piece.color !== playerColor) {
    return { ok: false, error: 'Cannot move opponent piece' };
  }

  const capturedPiece = game.board[to.row][to.col];

  game.history.push({
    from,
    to,
    movedPiece: piece,
    capturedPiece,
    turnBefore: game.turn
  });

  game.board[to.row][to.col] = piece;
  game.board[from.row][from.col] = null;
  game.turn = game.turn === 'white' ? 'black' : 'white';

  return { ok: true };
}

function undoLastMove(game) {
  const last = game.history.pop();
  if (!last) {
    return { ok: false, error: 'No moves to undo' };
  }

  game.board[last.from.row][last.from.col] = last.movedPiece;
  game.board[last.to.row][last.to.col] = last.capturedPiece;
  game.turn = last.turnBefore;

  return { ok: true };
}

module.exports = {
  createGameState,
  createInitialBoard: INITIAL_BOARD,
  applyMove,
  undoLastMove
};
