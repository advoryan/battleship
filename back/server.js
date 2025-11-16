import { WebSocketServer } from 'ws';
import { COMMANDS, SOCKET_PORT } from './constants.js';


const routeMessage = (wss, ws, message) => {
  const data = typeof message.data === 'string' ? safeJSONParse(message.data, message.data) : message.data;
  switch (message.type) {
    case COMMANDS.REG:
      handleRegistration(wss, ws, data);
      break;
    case COMMANDS.CREATE_ROOM:
      handleCreateRoom(wss, ws);
      break;
    case COMMANDS.ADD_USER_TO_ROOM:
      handleAddUserToRoom(wss, ws, data);
      break;
    case COMMANDS.ADD_SHIPS:
      handleAddShips(wss, ws, data);
      break;
    case COMMANDS.ATTACK:
      handleAttackCommand(wss, ws, data, false);
      break;
    case COMMANDS.RANDOM_ATTACK:
      handleAttackCommand(wss, ws, data, true);
      break;
    case COMMANDS.SINGLE_PLAY:
      handleSinglePlay(wss, ws);
      break;
    default:
      break;
  }
};

export const startWebSocketServer = () => {
  const wss = new WebSocketServer({ port: SOCKET_PORT });
  console.log(`WebSocket server is running on ws://localhost:${SOCKET_PORT}`);

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const message = safeJSONParse(raw);
      if (!message?.type) {
        return;
      }
      logCommand({ direction: 'in', type: message.type, data: message.data });
      routeMessage(wss, ws, message);
    });

    ws.on('close', () => handleDisconnect(wss, ws));
    ws.on('error', () => handleDisconnect(wss, ws));

    // send the latest public data snapshot
    sendRoomsUpdate(wss);
    sendWinnersUpdate(wss);
  });

  return wss;
};
