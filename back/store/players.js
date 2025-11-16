const DEFAULT_WINS = 0;

export class PlayersStore {
  constructor() {
    this.players = new Map();
    this.connections = new Map();
    this.sockets = new Map();
    this.indexSequence = 1;
  }

  register({ name, password }) {
    const trimmedName = name?.trim();
    if (!trimmedName || !password) {
      return { error: true, errorText: 'Name and password are required' };
    }

    const existing = this.players.get(trimmedName);
    if (existing) {
      if (existing.password !== password) {
        return { error: true, errorText: 'Invalid password' };
      }
      return {
        error: false,
        player: existing,
      };
    }

    const newPlayer = {
      name: trimmedName,
      password,
      wins: DEFAULT_WINS,
      index: `p-${this.indexSequence++}`,
    };
    this.players.set(trimmedName, newPlayer);
    return { error: false, player: newPlayer };
  }

  attachSocket(ws, playerName) {
    this.connections.set(ws, playerName);
    this.sockets.set(playerName, ws);
  }

  detachSocket(ws) {
    const playerName = this.connections.get(ws);
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

  getPlayerBySocket(ws) {
    const name = this.connections.get(ws);
    if (!name) {
      return null;
    }
    return this.players.get(name) ?? null;
  }

  getPlayerByName(name) {
    return this.players.get(name) ?? null;
  }

  getSocketByName(name) {
    return this.sockets.get(name) ?? null;
  }

  addWin(name) {
    const player = this.players.get(name);
    if (!player) {
      return;
    }
    player.wins += 1;
  }

  getScoreboard() {
    return [...this.players.values()]
      .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
      .map(({ name, wins }) => ({ name, wins }));
  }
}
