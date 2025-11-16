import { MAX_ROOM_PLAYERS } from '../constants.js';

export class RoomsStore {
  constructor() {
    this.rooms = new Map();
    this.playerRoom = new Map();
    this.sequence = 1;
  }

  createRoom(playerName, ws, playerIndex) {
    if (this.playerRoom.has(playerName)) {
      return { error: 'Player already in a room' };
    }
    const roomId = `r-${this.sequence++}`;
    const room = {
      id: roomId,
      roomUsers: [
        {
          name: playerName,
          index: playerIndex,
          ws,
        },
      ],
    };
    this.rooms.set(roomId, room);
    this.playerRoom.set(playerName, roomId);
    return { room };
  }

  getAvailableRooms() {
    return [...this.rooms.values()]
      .filter((room) => room.roomUsers.length === 1)
      .map((room) => ({
        roomId: room.id,
        roomUsers: room.roomUsers.map(({ name, index }) => ({ name, index })),
      }));
  }

  addUser(roomId, playerName, ws, playerIndex) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return { error: 'Room not found' };
    }
    if (room.roomUsers.length >= MAX_ROOM_PLAYERS) {
      return { error: 'Room already full' };
    }
    if (this.playerRoom.has(playerName)) {
      return { error: 'Player already in a room' };
    }
    room.roomUsers.push({ name: playerName, index: playerIndex, ws });
    this.playerRoom.set(playerName, roomId);
    const isReady = room.roomUsers.length === MAX_ROOM_PLAYERS;
    return { room, isReady };
  }

  removeRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }
    room.roomUsers.forEach(({ name }) => this.playerRoom.delete(name));
    this.rooms.delete(roomId);
  }

  removePlayer(playerName) {
    const roomId = this.playerRoom.get(playerName);
    if (!roomId) {
      return null;
    }
    const room = this.rooms.get(roomId);
    if (!room) {
      this.playerRoom.delete(playerName);
      return null;
    }
    room.roomUsers = room.roomUsers.filter((user) => user.name !== playerName);
    this.playerRoom.delete(playerName);
    if (!room.roomUsers.length) {
      this.rooms.delete(roomId);
      return null;
    }
    return room;
  }
}
