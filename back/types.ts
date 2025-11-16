import { WebSocket } from 'ws';

export type ShipType = 'small' | 'medium' | 'large' | 'huge';

export interface Position {
  x: number;
  y: number;
}

export interface Ship {
  position: Position;
  direction: boolean;
  length: number;
  type: ShipType;
}

export interface PlayerRecord {
  name: string;
  password: string;
  wins: number;
  index: string;
}

export interface RoomUser {
  name: string;
  index: string;
  ws: WebSocket;
}

export interface Room {
  id: string;
  roomUsers: RoomUser[];
}

export interface RegistrationPayload {
  name?: string;
  password?: string;
}

export interface RegistrationResponse {
  error: boolean;
  errorText?: string;
  player?: PlayerRecord;
}

export interface ScoreboardRow {
  name: string;
  wins: number;
}

export interface BotEngine {
  name: string;
  index: string;
  generateShips(): Ship[];
  chooseShot(options: Position[]): Position | null;
}

export interface ShipState extends Ship {
  id: string;
  cells: Set<string>;
  hits: Set<string>;
}

export interface BoardState {
  ships: Map<string, ShipState>;
  cells: Map<string, string>;
  sunkShips: Set<string>;
}

export interface GamePlayer {
  playerName: string;
  playerIndex: string;
  ws: WebSocket | null;
  ships: Ship[];
  board: BoardState | null;
  ready: boolean;
  shots: Set<string>;
  isBot: boolean;
  botEngine: BotEngine | null;
}

export interface Game {
  id: string;
  players: Record<string, GamePlayer>;
  order: string[];
  turn: string | null;
  status: 'waiting' | 'active' | 'finished';
  winnerId: string | null;
  botTimers: Map<string, NodeJS.Timeout>;
}

export interface AttackResult {
  status: 'miss' | 'shot' | 'killed';
  shooterId: string;
  position: Position;
  contour: Array<{ key: string; position: Position }>;
  nextTurn: string | null;
  winnerId: string | null;
}

export interface LookupEntry {
  gameId: string;
  playerId: string;
}
