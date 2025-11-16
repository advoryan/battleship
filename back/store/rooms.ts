import { WebSocket } from 'ws';
import { MAX_ROOM_PLAYERS } from '../constants.js';
import type { Room, RoomUser } from '../types.js';

interface RoomSummaryUser {
  name: string;
  index: string;
}

interface RoomSummary {
  roomId: string;
  roomUsers: RoomSummaryUser[];
}

interface RoomCreationResult {
  room?: Room;
  error?: string;
}

interface AddUserResult {
  room?: Room;
  isReady?: boolean;
  error?: string;
}

export class RoomsStore {
  private readonly rooms = new Map<string, Room>();

  private readonly playerRoom = new Map<string, string>();

  private sequence = 1;

  createRoom(playerName: string, ws: WebSocket, playerIndex: string): RoomCreationResult {
    if (this.playerRoom.has(playerName)) {
      return { error: 'Player already in a room' };
    }
    const roomId = `r-${this.sequence++}`;
    const roomUser: RoomUser = { name: playerName, index: playerIndex, ws };
    const room: Room = {
      id: roomId,
      roomUsers: [roomUser],
    };
    this.rooms.set(roomId, room);
    this.playerRoom.set(playerName, roomId);
    return { room };
  }

  getAvailableRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.roomUsers.length === 1)
      .map((room) => ({
        roomId: room.id,
        roomUsers: room.roomUsers.map(({ name, index }) => ({ name, index })),
      }));
  }

  addUser(roomId: string, playerName: string, ws: WebSocket, playerIndex: string): AddUserResult {
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
    return { room, isReady: room.roomUsers.length === MAX_ROOM_PLAYERS };
  }

  removeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }
    room.roomUsers.forEach(({ name }) => this.playerRoom.delete(name));
    this.rooms.delete(roomId);
  }

  removePlayer(playerName: string): Room | null {
    const roomId = this.playerRoom.get(playerName);
    if (!roomId) {
      return null;
    }
    const room = this.rooms.get(roomId);
    this.playerRoom.delete(playerName);
    if (!room) {
      return null;
    }
    room.roomUsers = room.roomUsers.filter((user) => user.name !== playerName);
    if (!room.roomUsers.length) {
      this.rooms.delete(roomId);
      return null;
    }
    return room;
  }
}
