import type { WebSocket } from 'ws';
import { BOARD_SIZE } from '../constants.js';
import type {
  AttackResult,
  BoardState,
  BotEngine,
  Game,
  GamePlayer,
  LookupEntry,
  PlayerRecord,
  Position,
  Room,
  Ship,
  ShipState,
} from '../types.js';

interface CreateGamePayload {
  socket: WebSocket | null;
  data: {
    idGame: string;
    idPlayer: string;
  };
}

const withinBoard = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
const cellKey = (x: number, y: number): string => `${x},${y}`;

const expandShipCells = (ship: Ship): string[] => {
  const { position, direction } = ship;
  const length = Number(ship.length) || 1;
  const cells: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const x = direction ? position.x : position.x + i;
    const y = direction ? position.y + i : position.y;
    if (withinBoard(x, y)) {
      cells.push(cellKey(x, y));
    }
  }
  return cells;
};

const buildBoardState = (ships: Ship[]): BoardState => {
  const board: BoardState = {
    ships: new Map<string, ShipState>(),
    cells: new Map<string, string>(),
    sunkShips: new Set<string>(),
  };

  ships.forEach((ship, index) => {
    const id = `ship-${index}`;
    const cells = expandShipCells(ship);
    const cellSet = new Set(cells);
    const shipState: ShipState = {
      ...ship,
      id,
      cells: cellSet,
      hits: new Set<string>(),
    };
    board.ships.set(id, shipState);
    cells.forEach((cell) => board.cells.set(cell, id));
  });

  return board;
};

const contourCoordinates = (cellSet: Set<string>): Array<{ key: string; position: Position }> => {
  const buffer = new Set<string>();
  cellSet.forEach((key) => {
    const [x, y] = key.split(',').map(Number);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const nx = x + dx;
        const ny = y + dy;
        const neighborKey = cellKey(nx, ny);
        if (!withinBoard(nx, ny) || cellSet.has(neighborKey)) {
          continue;
        }
        buffer.add(neighborKey);
      }
    }
  });

  return [...buffer].map((key) => {
    const [x, y] = key.split(',').map(Number);
    return { key, position: { x, y } };
  });
};

const randomItem = <T>(items: T[]): T | null => {
  if (!items.length) {
    return null;
  }
  const index = Math.floor(Math.random() * items.length);
  return items[index];
};

export class GamesStore {
  private readonly games = new Map<string, Game>();

  private readonly playerLookup = new Map<string, LookupEntry>();

  private sequence = 1;

  private nextGameId(): string {
    return `g-${this.sequence++}`;
  }

  private buildPlayerRecord(
    playerName: string,
    playerIndex: string,
    ws: WebSocket | null,
    isBot = false,
    botEngine: BotEngine | null = null,
  ): GamePlayer {
    return {
      playerName,
      playerIndex,
      ws,
      ships: [],
      board: null,
      ready: false,
      shots: new Set<string>(),
      isBot,
      botEngine,
    };
  }

  private allPlayersReady(game: Game): boolean {
    return game.order.every((playerId) => game.players[playerId].ready);
  }

  private applyPlayerLookup(gameId: string, playerId: string, playerName: string, isBot: boolean): void {
    if (!isBot) {
      this.playerLookup.set(playerName, { gameId, playerId });
    }
  }

  private applyContourToShots(player: GamePlayer, contour: Array<{ key: string }>): void {
    contour.forEach(({ key }) => player.shots.add(key));
  }

  private finishGame(gameId: string, winnerId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }
    game.status = 'finished';
    game.winnerId = winnerId;
    game.order.forEach((playerId) => {
      const playerName = game.players[playerId].playerName;
      if (playerName) {
        this.playerLookup.delete(playerName);
      }
    });
  }

  isPlayerBusy(name: string): boolean {
    return this.playerLookup.has(name);
  }

  getGame(gameId: string): Game | undefined {
    return this.games.get(gameId);
  }

  getLookup(name: string): LookupEntry | undefined {
    return this.playerLookup.get(name);
  }

  createFromRoom(room: Room): { game: Game; payloads: CreateGamePayload[] } | null {
    if (!room?.roomUsers || room.roomUsers.length < 2) {
      return null;
    }

    const gameId = this.nextGameId();
    const players: Record<string, GamePlayer> = {};
    const order: string[] = [];

    room.roomUsers.forEach((user, index) => {
      const playerId = `${gameId}-p-${index + 1}`;
      players[playerId] = this.buildPlayerRecord(user.name, user.index, user.ws, false, null);
      order.push(playerId);
      this.applyPlayerLookup(gameId, playerId, user.name, false);
    });

    const game: Game = {
      id: gameId,
      players,
      order,
      turn: null,
      status: 'waiting',
      winnerId: null,
      botTimers: new Map<string, NodeJS.Timeout>(),
    };

    this.games.set(gameId, game);

    const payloads: CreateGamePayload[] = order.map((playerId) => ({
      socket: players[playerId].ws,
      data: { idGame: gameId, idPlayer: playerId },
    }));

    return { game, payloads };
  }

  createSinglePlayerGame(playerRecord: PlayerRecord, ws: WebSocket, botEngine: BotEngine): {
    game: Game;
    payloads: CreateGamePayload[];
    botId: string;
  } {
    const gameId = this.nextGameId();
    const humanId = `${gameId}-p-1`;
    const botId = `${gameId}-p-2`;

    const players: Record<string, GamePlayer> = {
      [humanId]: this.buildPlayerRecord(playerRecord.name, playerRecord.index, ws),
      [botId]: this.buildPlayerRecord(botEngine.name, botEngine.index, null, true, botEngine),
    };

    players[botId].ships = botEngine.generateShips();
    players[botId].board = buildBoardState(players[botId].ships);
    players[botId].ready = true;

    this.applyPlayerLookup(gameId, humanId, playerRecord.name, false);

    const game: Game = {
      id: gameId,
      players,
      order: [humanId, botId],
      turn: null,
      status: 'waiting',
      winnerId: null,
      botTimers: new Map<string, NodeJS.Timeout>(),
    };

    this.games.set(gameId, game);

    return {
      game,
      payloads: [{ socket: ws, data: { idGame: gameId, idPlayer: humanId } }],
      botId,
    };
  }

  registerShips(gameId: string, playerId: string, ships: Ship[]): { error?: string; game?: Game; ready?: boolean; turn?: string | null } {
    const game = this.games.get(gameId);
    if (!game) {
      return { error: 'Game not found' };
    }
    const player = game.players[playerId];
    if (!player) {
      return { error: 'Player not found in game' };
    }
    player.ships = ships ?? [];
    player.board = buildBoardState(player.ships);
    player.ready = true;

    if (this.allPlayersReady(game)) {
      const turn = this.startGame(game);
      return { game, ready: true, turn };
    }

    return { game, ready: false };
  }

  private startGame(game: Game): string | null {
    if (!game.turn) {
      game.turn = randomItem(game.order);
    }
    game.status = 'active';
    return game.turn ?? null;
  }

  getOpponentId(game: Game, playerId: string): string {
    return game.order.find((id) => id !== playerId) ?? playerId;
  }

  private getAvailableShots(player: GamePlayer): Position[] {
    const attempts = player.shots;
    const options: Position[] = [];
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

  handleAttack(gameId: string, attackerId: string, x: number, y: number): AttackResult | { error: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { error: 'Game not found' };
    }
    if (game.status !== 'active') {
      return { error: 'Game is not active' };
    }
    if (game.turn !== attackerId) {
      return { error: 'Not your turn' };
    }

    const attacker = game.players[attackerId];
    const defenderId = this.getOpponentId(game, attackerId);
    const defender = game.players[defenderId];
    if (!attacker || !defender || !defender.board) {
      return { error: 'Invalid game state' };
    }

    const key = cellKey(x, y);
    if (attacker.shots.has(key)) {
      return { error: 'Cell already targeted' };
    }
    attacker.shots.add(key);

    const shipId = defender.board.cells.get(key);
    if (!shipId) {
      game.turn = defenderId;
      return {
        status: 'miss',
        shooterId: attackerId,
        position: { x, y },
        contour: [],
        nextTurn: defenderId,
        winnerId: null,
      };
    }

    const ship = defender.board.ships.get(shipId);
    if (!ship) {
      game.turn = defenderId;
      return {
        status: 'miss',
        shooterId: attackerId,
        position: { x, y },
        contour: [],
        nextTurn: defenderId,
        winnerId: null,
      };
    }

    ship.hits.add(key);
    const killed = ship.hits.size === ship.cells.size;
    if (killed) {
      defender.board.sunkShips.add(shipId);
    }

    const contour = killed ? contourCoordinates(ship.cells) : [];
    this.applyContourToShots(attacker, contour);

    const allKilled = defender.board.sunkShips.size === defender.board.ships.size;
    if (allKilled) {
      this.finishGame(gameId, attackerId);
    }

    const status: AttackResult['status'] = killed ? 'killed' : 'shot';
    const nextTurn = attackerId;
    game.turn = attackerId;

    return {
      status,
      shooterId: attackerId,
      position: { x, y },
      contour,
      nextTurn,
      winnerId: allKilled ? attackerId : null,
    };
  }

  randomAttack(gameId: string, attackerId: string): AttackResult | { error: string } {
    const game = this.games.get(gameId);
    if (!game) {
      return { error: 'Game not found' };
    }
    if (game.turn !== attackerId) {
      return { error: 'Not your turn' };
    }
    const attacker = game.players[attackerId];
    if (!attacker) {
      return { error: 'Player not found in game' };
    }
    const options = this.getAvailableShots(attacker);
    const picked = attacker.isBot && attacker.botEngine
      ? attacker.botEngine.chooseShot(options)
      : randomItem(options);
    if (!picked) {
      return { error: 'No available shots' };
    }
    return this.handleAttack(gameId, attackerId, picked.x, picked.y);
  }

  removeGame(gameId: string): void {
    const game = this.games.get(gameId);
    if (!game) {
      return;
    }
    game.order.forEach((playerId) => {
      const name = game.players[playerId].playerName;
      if (name) {
        this.playerLookup.delete(name);
      }
    });
    this.games.delete(gameId);
  }

  handleDisconnect(playerName: string): { opponent?: GamePlayer; game: Game } | null {
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
    this.removeGame(game.id);
    return { opponent, game };
  }
}
