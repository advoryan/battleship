import { WebSocket } from 'ws';
import type {
  PlayerRecord,
  RegistrationPayload,
  RegistrationResponse,
  ScoreboardRow,
} from '../types.js';

const DEFAULT_WINS = 0;

export class PlayersStore {
  private readonly players = new Map<string, PlayerRecord>();

  private readonly connections = new Map<WebSocket, string>();

  private readonly sockets = new Map<string, WebSocket>();

  private indexSequence = 1;

  register({ name, password }: RegistrationPayload): RegistrationResponse {
    const trimmedName = name?.trim();
    if (!trimmedName || !password) {
      return { error: true, errorText: 'Name and password are required' };
    }

    const existing = this.players.get(trimmedName);
    if (existing) {
      if (existing.password !== password) {
        return { error: true, errorText: 'Invalid password' };
      }
      return { error: false, player: existing };
    }

    const newPlayer: PlayerRecord = {
      name: trimmedName,
      password,
      wins: DEFAULT_WINS,
      index: `p-${this.indexSequence++}`,
    };

    this.players.set(trimmedName, newPlayer);
    return { error: false, player: newPlayer };
  }

  attachSocket(ws: WebSocket, playerName: string): void {
    this.connections.set(ws, playerName);
    this.sockets.set(playerName, ws);
  }

  detachSocket(ws: WebSocket): string | null {
    const playerName = this.connections.get(ws) ?? null;
    if (!playerName) {
      return null;
    }
    this.connections.delete(ws);
    const socket = this.sockets.get(playerName);
    if (socket === ws) {
      this.sockets.delete(playerName);
    }
    return playerName;
  }

  getPlayerBySocket(ws: WebSocket): PlayerRecord | null {
    const name = this.connections.get(ws);
    if (!name) {
      return null;
    }
    return this.players.get(name) ?? null;
  }

  getPlayerByName(name: string): PlayerRecord | null {
    return this.players.get(name) ?? null;
  }

  getSocketByName(name: string): WebSocket | undefined {
    return this.sockets.get(name);
  }

  addWin(name: string): void {
    const player = this.players.get(name);
    if (player) {
      player.wins += 1;
    }
  }

  getScoreboard(): ScoreboardRow[] {
    return [...this.players.values()]
      .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
      .map(({ name, wins }) => ({ name, wins }));
  }
}
