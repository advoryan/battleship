import { BOARD_SIZE } from '../constants.js';

const withinBoard = (x, y) => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
const cellKey = (x, y) => `${x},${y}`;

const expandShipCells = (ship) => {
  const { position = { x: 0, y: 0 }, direction = false } = ship;
  const length = Number(ship.length) || 1;
  const cells = [];
  for (let i = 0; i < length; i += 1) {
    const x = direction ? position.x : position.x + i;
    const y = direction ? position.y + i : position.y;
    if (!withinBoard(x, y)) {
      continue;
    }
    cells.push(cellKey(x, y));
  }
  return cells;
};

const buildBoardState = (ships = []) => {
  const board = {
    ships: new Map(),
    cells: new Map(),
    sunkShips: new Set(),
  };

  ships.forEach((ship, index) => {
    const id = `ship-${index}`;
    const cells = expandShipCells(ship);
    const cellSet = new Set(cells);
    board.ships.set(id, {
      ...ship,
      id,
      cells: cellSet,
      hits: new Set(),
    });
    cells.forEach((cell) => {
      board.cells.set(cell, id);
    });
  });

  return board;
};

const contourCoordinates = (cellSet) => {
  const buffer = new Set();
  const coordinates = [...cellSet].map((key) => key.split(',').map(Number));

  coordinates.forEach(([x, y]) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const nx = x + dx;
        const ny = y + dy;
        const key = cellKey(nx, ny);
        if (!withinBoard(nx, ny) || cellSet.has(key)) {
          continue;
        }
        buffer.add(key);
      }
    }
  });

  return [...buffer].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { key, position: { x, y } };
  });
};

const randomItem = (items) => {
  if (!items.length) {
    return null;
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

export class GamesStore {
  constructor(playersStore) {
    this.playersStore = playersStore;
    this.games = new Map();
    this.playerLookup = new Map(); // playerName -> { gameId, playerId }
    this.sequence = 1;
  }

  _nextGameId() {
    return `g-${this.sequence++}`;
  }

  _buildPlayerRecord({ playerName, playerIndex, ws, isBot = false, botEngine = null }) {
    return {
      playerName,
      playerIndex,
      ws,
      ships: [],
      board: null,
      ready: false,
      shots: new Set(),
      isBot,
      botEngine,
    };
  }

  _applyPlayerLookup(gameId, playerRecord, playerId) {
    if (playerRecord.isBot) {
      return;
    }
    this.playerLookup.set(playerRecord.playerName, { gameId, playerId });
  }

  createFromRoom(room) {
    if (!room?.roomUsers || room.roomUsers.length < 2) {
      return null;
    }

    const gameId = this._nextGameId();
    const players = {};
    const order = [];

    room.roomUsers.forEach((user, index) => {
      const playerId = `${gameId}-p-${index + 1}`;
      players[playerId] = this._buildPlayerRecord({
        playerName: user.name,
        playerIndex: user.index,
        ws: user.ws,
      });
      order.push(playerId);
      this._applyPlayerLookup(gameId, players[playerId], playerId);
    });

    const game = {
      id: gameId,
      players,
      order,
      turn: null,
      status: 'waiting',
      winnerId: null,
      botTimers: new Map(),
    };

    this.games.set(gameId, game);

    return {
      game,
      payloads: order.map((playerId) => ({
        socket: game.players[playerId].ws,
        data: { idGame: gameId, idPlayer: playerId },
      })),
    };
  }

  createSinglePlayerGame(playerRecord, ws, botEngine) {
    const gameId = this._nextGameId();
    const humanId = `${gameId}-p-1`;
    const botId = `${gameId}-p-2`;

    const players = {
      [humanId]: this._buildPlayerRecord({
        playerName: playerRecord.name,
        playerIndex: playerRecord.index,
        ws,
      }),
      [botId]: this._buildPlayerRecord({
        playerName: botEngine.name,
        playerIndex: botEngine.index,
        ws: null,
        isBot: true,
        botEngine,
      }),
    };

    players[botId].ships = botEngine.generateShips();
    players[botId].board = buildBoardState(players[botId].ships);
    players[botId].ready = true;

    this.playerLookup.set(playerRecord.name, { gameId, playerId: humanId });

    const game = {
      id: gameId,
      players,
      order: [humanId, botId],
      turn: null,
      status: 'waiting',
      winnerId: null,
      botTimers: new Map(),
    };

    this.games.set(gameId, game);

    return {
      game,
      payloads: [
        {
          socket: ws,
          data: { idGame: gameId, idPlayer: humanId },
        },
      ],
      botId,
    };
  }

  assignBotShips(gameId, botId) {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }
    const bot = game.players[botId];
    if (!bot || !bot.isBot || bot.board) {
      return;
    }
    bot.ships = bot.botEngine.generateShips();
    bot.board = buildBoardState(bot.ships);
    bot.ready = true;
  }

  getLookup(name) {
    return this.playerLookup.get(name);
  }

  isPlayerBusy(name) {
    return this.playerLookup.has(name);
  }

  _allPlayersReady(game) {
    return game.order.every((playerId) => game.players[playerId].ready);
  }

  registerShips(gameId, playerId, ships) {
    const game = this.games.get(gameId);
    if (!game) {
      return { error: 'Game not found' };
    }
    const player = game.players[playerId];
    if (!player) {
      return { error: 'Player not found in game' };
    }
    player.ships = ships;
    player.board = buildBoardState(ships);
    player.ready = true;
    if (this._allPlayersReady(game)) {
      const turn = this.startGame(game);
      return { game, ready: true, turn };
    }
    return { game, ready: false };
  }

  startGame(game) {
    if (!game.turn) {
      game.turn = randomItem(game.order);
    }
    game.status = 'active';
    return game.turn;
  }

  getOpponentId(game, playerId) {
    return game.order.find((id) => id !== playerId);
  }

  _getAvailableShots(player) {
    const attempts = player.shots;
    const options = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const key = cellKey(x, y);
        if (!attempts.has(key)) {
          options.push({ x, y });
        }
      }
    }
    return options;
  }

  _applyContourToShots(player, contour) {
    contour.forEach(({ key }) => {
      player.shots.add(key);
    });
  }

  _finishGame(gameId, winnerId) {
    const game = this.games.get(gameId);
    if (!game) {
      return null;
    }
    game.status = 'finished';
    game.winnerId = winnerId;
    game.order.forEach((playerId) => {
      const playerName = game.players[playerId].playerName;
      if (playerName) {
        this.playerLookup.delete(playerName);
      }
    });
    return game;
  }

  handleDisconnect(playerName) {
    const lookup = this.playerLookup.get(playerName);
    if (!lookup) {
      return null;
    }
    const game = this.games.get(lookup.gameId);
    if (!game) {
      this.playerLookup.delete(playerName);
      return null;
    }
    const opponentId = this.getOpponentId(game, lookup.playerId);
    const opponent = game.players[opponentId];
    const payload = { opponent, game };
    this.removeGame(game.id);
    return payload;
  }
}
