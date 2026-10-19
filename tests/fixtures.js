'use strict';
// Colonist-shaped state messages for board/advisor/integration tests. The
// coordinates follow colonist's axial scheme; a radius-2 hexagon of 19 tiles.
const { CT } = require('./helpers');
const { TILE } = CT;

const LAND = [
  [0, -2, TILE.Ore, 10], [1, -2, TILE.Wool, 2], [2, -2, TILE.Lumber, 9],
  [-1, -1, TILE.Grain, 12], [0, -1, TILE.Brick, 6], [1, -1, TILE.Wool, 4], [2, -1, TILE.Brick, 10],
  [-2, 0, TILE.Grain, 9], [-1, 0, TILE.Lumber, 11], [0, 0, TILE.Desert, 0], [1, 0, TILE.Lumber, 3], [2, 0, TILE.Ore, 8],
  [-2, 1, TILE.Lumber, 8], [-1, 1, TILE.Ore, 3], [0, 1, TILE.Grain, 4], [1, 1, TILE.Wool, 5],
  [-2, 2, TILE.Brick, 5], [-1, 2, TILE.Grain, 6], [0, 2, TILE.Wool, 11],
];

function mapState(extra = {}) {
  const tileHexStates = {};
  LAND.forEach(([x, y, type, diceNumber], i) => { tileHexStates[i] = { x, y, type, diceNumber }; });
  // a ring of sea tiles so the model sees a bordered island
  let idx = LAND.length;
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) {
    if (Math.max(Math.abs(x), Math.abs(y), Math.abs(x + y)) !== 3) continue;
    tileHexStates[idx++] = { x, y, type: TILE.Sea, diceNumber: 0 };
  }
  const tileCornerStates = {};
  const tileEdgeStates = {};
  // ore port on the sea edge north-east of Ore 8; a 3:1 port south of Brick 5
  // (port types have their own enum: 1 = generic 3:1, 2 lumber, 3 brick, 4 wool, 5 grain, 6 ore)
  const portEdgeStates = { 0: { x: 3, y: -1, z: 2, type: 6 }, 1: { x: -2, y: 2, z: 2, type: 1 } };
  return Object.assign({ tileHexStates, tileCornerStates, tileEdgeStates, portEdgeStates }, extra);
}

function playerState(color, discardLimit = 7) {
  return { color, victoryPointsState: {}, bankTradeRatiosState: {}, resourceCards: { cards: [] }, cardDiscardLimit: discardLimit, isTakingAction: false, isConnected: true };
}

function gameState(overrides = {}) {
  return Object.assign({
    diceState: {}, bankState: {},
    mapState: mapState(),
    currentState: { completedTurns: 0, turnState: 1, actionState: 1, currentTurnPlayerColor: 1, startTime: 0, allocatedTime: 0 },
    playerStates: { 1: playerState(1), 2: playerState(2) },
    gameLogState: {}, gameChatState: {},
  }, overrides);
}

function roomState(overrides = {}) {
  return Object.assign({
    roomId: 'abc123', private: true, victoryPointsToWin: 13, cardDiscardLimit: 9, maxPlayers: 4, friendlyRobber: false,
    sessions: [
      { roomSessionId: 1, userSessionId: 's-ahab', username: 'Ahab', selectedColor: 1, isBot: false },
      { roomSessionId: 2, userSessionId: 's-beth', username: 'Beth', selectedColor: 2, isBot: true },
    ],
  }, overrides);
}

module.exports = { LAND, mapState, gameState, roomState, playerState };
