const parsePort = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const BOARD_SIZE = 10;
export const COMMANDS = {
  REG: 'reg',
  CREATE_ROOM: 'create_room',
  ADD_USER_TO_ROOM: 'add_user_to_room',
  ADD_SHIPS: 'add_ships',
  ATTACK: 'attack',
  RANDOM_ATTACK: 'randomAttack',
  UPDATE_ROOM: 'update_room',
  UPDATE_WINNERS: 'update_winners',
  CREATE_GAME: 'create_game',
  START_GAME: 'start_game',
  TURN: 'turn',
  FINISH: 'finish',
  SINGLE_PLAY: 'single_play',
  DISCONNECT: 'diconnect',
};

export const RESPONSE_ID = 0;
export const SOCKET_PORT = parsePort(process.env.SOCKET_PORT, 3000);

export const SHIP_TYPES = ['small', 'medium', 'large', 'huge'];

export const MAX_ROOM_PLAYERS = 2;
