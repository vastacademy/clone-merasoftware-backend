const mongoose = require('mongoose');

const chessMoveSchema = new mongoose.Schema({
  from: {
    row: { type: Number, required: true },
    col: { type: Number, required: true }
  },
  to: {
    row: { type: Number, required: true },
    col: { type: Number, required: true }
  },
  movedPiece: { type: mongoose.Schema.Types.Mixed, required: true },
  capturedPiece: { type: mongoose.Schema.Types.Mixed, default: null },
  turnBefore: { type: String, enum: ['white', 'black'], required: true }
}, { _id: false });

const chessGameSchema = new mongoose.Schema({
  roomCode: {
    type: String,
    required: true,
    unique: true
  },
  players: {
    white: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null },
    black: { type: mongoose.Schema.Types.ObjectId, ref: 'user', default: null }
  },
  board: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  turn: {
    type: String,
    enum: ['white', 'black'],
    default: 'white'
  },
  history: {
    type: [chessMoveSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['active', 'reset-pending', 'closed'],
    default: 'active'
  },
  paletteKey: {
    type: String,
    enum: ['classicGreen', 'oceanBlue', 'walnutBrown', 'slateGray'],
    default: 'classicGreen'
  },
  resetRequestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    default: null
  }
}, { timestamps: true });

module.exports = mongoose.model('chessGame', chessGameSchema);
