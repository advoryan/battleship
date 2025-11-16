import { WebSocketServer, WebSocket } from 'ws';
import { COMMANDS, SOCKET_PORT } from './constants.js';
import { PlayersStore } from './store/players.js';
import { RoomsStore } from './store/rooms.js';
import { GamesStore } from './store/games.js';
import { SimpleBot } from './bot/simpleBot.js';
import { broadcast, logCommand, safeJSONParse, sendMessage } from './utils/messages.js';
import type { AttackResult, Game, GamePlayer, PlayerRecord, RegistrationPayload, Ship } from './types.js';

const playersStore = new PlayersStore();
const roomsStore = new RoomsStore();
const gamesStore = new GamesStore();

type SocketMessage = {
  type: string;
  data: string;
  id: number;
};

const sendRoomsUpdate = (wss: WebSocketServer): void => {
  const data = roomsStore.getAvailableRooms();
  const clients = wss.clients ? [...wss.clients] : [];
  broadcast(clients, COMMANDS.UPDATE_ROOM, data);
  logCommand({ direction: 'out', type: COMMANDS.UPDATE_ROOM, data });
};

const sendWinnersUpdate = (wss: WebSocketServer): void => {
  const data = playersStore.getScoreboard();
  const clients = wss.clients ? [...wss.clients] : [];
  broadcast(clients, COMMANDS.UPDATE_WINNERS, data);
  logCommand({ direction: 'out', type: COMMANDS.UPDATE_WINNERS, data });
};

const notifyTurn = (game: Game, currentPlayer: string): void => {
  const payload = { currentPlayer };
  game.order.forEach((playerId) => {
    const socket = game.players[playerId].ws;
    if (socket) {
      sendMessage(socket, COMMANDS.TURN, payload);
    }
  });
  logCommand({ direction: 'out', type: COMMANDS.TURN, data: payload });
};

const notifyAttack = (game: Game, payload: { position: { x: number; y: number }; currentPlayer: string; status: AttackResult['status'] }): void => {
  game.order.forEach((playerId) => {
    const socket = game.players[playerId].ws;
    if (socket) {
      sendMessage(socket, COMMANDS.ATTACK, payload);
    }
  });
  logCommand({ direction: 'out', type: COMMANDS.ATTACK, data: payload });
};

const sendContourMisses = (game: Game, shooterId: string, contour: AttackResult['contour']): void => {
  contour.forEach(({ position }) => {
    notifyAttack(game, {
      position,
      currentPlayer: shooterId,
      status: 'miss',
    });
  });
};

const clearGameTimers = (game: Game): void => {
  game.botTimers.forEach((timer) => clearTimeout(timer));
  game.botTimers.clear();
};

const finalizeGame = (wss: WebSocketServer, gameId: string, winnerId: string): void => {
  const game = gamesStore.getGame(gameId);
  if (!game) {
    return;
  }
  const payload = { winPlayer: winnerId };
  game.order.forEach((playerId) => {
    const socket = game.players[playerId].ws;
    if (socket) {
      sendMessage(socket, COMMANDS.FINISH, payload);
    }
  });
  logCommand({ direction: 'out', type: COMMANDS.FINISH, data: payload });

  const winner = game.players[winnerId];
  if (winner && !winner.isBot) {
    playersStore.addWin(winner.playerName);
    sendWinnersUpdate(wss);
  }

  clearGameTimers(game);
  gamesStore.removeGame(gameId);
};

const scheduleBotTurn = (wss: WebSocketServer, gameId: string, botId: string): void => {
  const game = gamesStore.getGame(gameId);
  if (!game) {
    return;
  }
  const bot = game.players[botId];
  if (!bot?.isBot || game.turn !== botId || game.status !== 'active') {
    return;
  }
  if (game.botTimers.has(botId)) {
    clearTimeout(game.botTimers.get(botId)!);
  }
  const timeout = setTimeout(() => {
    const attackResult = gamesStore.randomAttack(gameId, botId);
    if ('error' in attackResult) {
      return;
    }
    handleAttackResult(wss, gameId, attackResult);
  }, 700);
  game.botTimers.set(botId, timeout);
};

const handleAttackResult = (wss: WebSocketServer, gameId: string, result: AttackResult): void => {
  const game = gamesStore.getGame(gameId);
  if (!game) {
    return;
  }

  const payload = {
    position: result.position,
    currentPlayer: result.shooterId,
    status: result.status,
  };

  notifyAttack(game, payload);

  if (result.contour.length) {
    sendContourMisses(game, result.shooterId, result.contour);
  }

  if (result.winnerId) {
    finalizeGame(wss, gameId, result.winnerId);
    return;
  }

  if (result.nextTurn) {
    notifyTurn(game, result.nextTurn);
    const nextPlayer = game.players[result.nextTurn];
    if (nextPlayer?.isBot) {
      scheduleBotTurn(wss, gameId, result.nextTurn);
    }
  }
};

const ensurePlayerReadyForGame = (ws: WebSocket): { error?: string; player?: PlayerRecord } => {
  const player = playersStore.getPlayerBySocket(ws);
  if (!player) {
    return { error: 'Player not registered' };
  }
  if (gamesStore.isPlayerBusy(player.name)) {
    return { error: 'Player already in active game' };
  }
  return { player };
};

const handleRegistration = (wss: WebSocketServer, ws: WebSocket, payload: RegistrationPayload): void => {
  const { error, errorText, player } = playersStore.register(payload);
  const response = {
    name: payload?.name ?? '',
    index: player?.index ?? null,
    error,
    errorText: error ? errorText : '',
  };
  if (!error && player) {
    playersStore.attachSocket(ws, player.name);
    sendRoomsUpdate(wss);
    sendWinnersUpdate(wss);
  }
  sendMessage(ws, COMMANDS.REG, response);
  logCommand({ direction: 'out', type: COMMANDS.REG, data: response });
};

const handleCreateRoom = (wss: WebSocketServer, ws: WebSocket): void => {
  const player = playersStore.getPlayerBySocket(ws);
  if (!player || gamesStore.isPlayerBusy(player.name)) {
    return;
  }
  const { error } = roomsStore.createRoom(player.name, ws, player.index);
  if (error) {
    return;
  }
  sendRoomsUpdate(wss);
};

interface AddUserPayload {
  indexRoom?: string;
}

const handleAddUserToRoom = (wss: WebSocketServer, ws: WebSocket, payload: AddUserPayload): void => {
  const player = playersStore.getPlayerBySocket(ws);
  if (!player || gamesStore.isPlayerBusy(player.name) || !payload?.indexRoom) {
    return;
  }
  const { room, isReady, error } = roomsStore.addUser(payload.indexRoom, player.name, ws, player.index);
  if (error || !room) {
    return;
  }
  if (!isReady) {
    sendRoomsUpdate(wss);
    return;
  }
  const creation = gamesStore.createFromRoom(room);
  if (!creation) {
    return;
  }
  roomsStore.removeRoom(room.id);
  creation.payloads.forEach(({ socket, data }) => {
    if (socket) {
      sendMessage(socket, COMMANDS.CREATE_GAME, data);
      logCommand({ direction: 'out', type: COMMANDS.CREATE_GAME, data });
    }
  });
  sendRoomsUpdate(wss);
};

const handleSinglePlay = (wss: WebSocketServer, ws: WebSocket): void => {
  const readiness = ensurePlayerReadyForGame(ws);
  if (readiness.error || !readiness.player) {
    return;
  }
  roomsStore.removePlayer(readiness.player.name);
  const bot = new SimpleBot();
  const { game, payloads } = gamesStore.createSinglePlayerGame(readiness.player, ws, bot);
  payloads.forEach(({ socket, data }) => {
    if (socket) {
      sendMessage(socket, COMMANDS.CREATE_GAME, data);
      logCommand({ direction: 'out', type: COMMANDS.CREATE_GAME, data });
    }
  });
  sendRoomsUpdate(wss);
  if (game.turn) {
    const current = game.players[game.turn];
    if (current?.isBot) {
      scheduleBotTurn(wss, game.id, game.turn);
    }
  }
};

interface AddShipsPayload {
  gameId?: string;
  ships?: Ship[];
  indexPlayer?: string;
}

const handleAddShips = (wss: WebSocketServer, ws: WebSocket, payload: AddShipsPayload): void => {
  const { gameId, ships, indexPlayer } = payload || {};
  if (!gameId || !indexPlayer || !Array.isArray(ships)) {
    return;
  }
  const player = playersStore.getPlayerBySocket(ws);
  if (!player) {
    return;
  }
  const game = gamesStore.getGame(gameId);
  if (!game) {
    return;
  }
  const participant = game.players[indexPlayer];
  if (!participant || participant.playerName !== player.name || participant.ws !== ws) {
    return;
  }
  const result = gamesStore.registerShips(gameId, indexPlayer, ships);
  if (result.error || !result.game) {
    return;
  }
  if (!result.ready || !result.turn) {
    return;
  }
  const updatedGame = result.game;
  updatedGame.order.forEach((playerId) => {
    const socket = updatedGame.players[playerId].ws;
    if (socket) {
      const data = {
        ships: updatedGame.players[playerId].ships,
        currentPlayerIndex: result.turn,
      };
      sendMessage(socket, COMMANDS.START_GAME, data);
      logCommand({ direction: 'out', type: COMMANDS.START_GAME, data });
    }
  });
  notifyTurn(updatedGame, result.turn);
  const current = updatedGame.players[result.turn];
  if (current?.isBot) {
    scheduleBotTurn(wss, updatedGame.id, result.turn);
  }
};

interface AttackPayload {
  gameId?: string;
  indexPlayer?: string;
  x?: number;
  y?: number;
}

const handleAttackCommand = (wss: WebSocketServer, ws: WebSocket, payload: AttackPayload, random = false): void => {
  const { gameId, indexPlayer, x, y } = payload || {};
  if (!gameId || !indexPlayer) {
    return;
  }
  const game = gamesStore.getGame(gameId);
  if (!game) {
    return;
  }
  const attacker = game.players[indexPlayer];
  if (!attacker) {
    return;
  }
  if (!attacker.isBot && attacker.ws !== ws) {
    return;
  }
  const result = random
    ? gamesStore.randomAttack(gameId, indexPlayer)
    : gamesStore.handleAttack(gameId, indexPlayer, Number(x), Number(y));
  if ('error' in result) {
    return;
  }
  handleAttackResult(wss, gameId, result);
};

const handleDisconnect = (wss: WebSocketServer, ws: WebSocket): void => {
  const playerName = playersStore.detachSocket(ws);
  if (!playerName) {
    return;
  }
  const outcome = gamesStore.handleDisconnect(playerName);
  if (outcome?.game) {
    clearGameTimers(outcome.game);
  }
  if (outcome?.opponent?.ws) {
    sendMessage(outcome.opponent.ws, COMMANDS.DISCONNECT, { reason: 'opponent_left' });
    logCommand({ direction: 'out', type: COMMANDS.DISCONNECT, data: { reason: 'opponent_left' } });
  }
  roomsStore.removePlayer(playerName);
  sendRoomsUpdate(wss);
};

const routeMessage = (wss: WebSocketServer, ws: WebSocket, message: SocketMessage): void => {
  const data = typeof message.data === 'string' ? safeJSONParse(message.data, message.data) : message.data;
  switch (message.type) {
    case COMMANDS.REG:
      handleRegistration(wss, ws, data as RegistrationPayload);
      break;
    case COMMANDS.CREATE_ROOM:
      handleCreateRoom(wss, ws);
      break;
    case COMMANDS.ADD_USER_TO_ROOM:
      handleAddUserToRoom(wss, ws, data as AddUserPayload);
      break;
    case COMMANDS.ADD_SHIPS:
      handleAddShips(wss, ws, data as AddShipsPayload);
      break;
    case COMMANDS.ATTACK:
      handleAttackCommand(wss, ws, data as AttackPayload, false);
      break;
    case COMMANDS.RANDOM_ATTACK:
      handleAttackCommand(wss, ws, data as AttackPayload, true);
      break;
    case COMMANDS.SINGLE_PLAY:
      handleSinglePlay(wss, ws);
      break;
    default:
      break;
  }
};

export const startWebSocketServer = (): WebSocketServer => {
  const wss = new WebSocketServer({ port: SOCKET_PORT });
  console.log(`WebSocket server is running on ws://localhost:${SOCKET_PORT}`);

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (raw) => {
      const message = safeJSONParse<SocketMessage | null>(raw, null);
      if (!message?.type) {
        return;
      }
      logCommand({ direction: 'in', type: message.type, data: message.data });
      routeMessage(wss, ws, message);
    });

    ws.on('close', () => handleDisconnect(wss, ws));
    ws.on('error', () => handleDisconnect(wss, ws));

    sendRoomsUpdate(wss);
    sendWinnersUpdate(wss);
  });

  return wss;
};
