import { BOARD_SIZE } from '../constants.js';
import type { BotEngine, Position, Ship } from '../types.js';

interface ShipTemplate {
  type: Ship['type'];
  length: number;
}

const fleetConfig: ShipTemplate[] = [
  { type: 'huge', length: 4 },
  { type: 'large', length: 3 },
  { type: 'large', length: 3 },
  { type: 'medium', length: 2 },
  { type: 'medium', length: 2 },
  { type: 'medium', length: 2 },
  { type: 'small', length: 1 },
  { type: 'small', length: 1 },
  { type: 'small', length: 1 },
  { type: 'small', length: 1 },
];

const cellKey = (x: number, y: number): string => `${x},${y}`;

const directions = [
  { dx: 1, dy: 0, direction: false },
  { dx: 0, dy: 1, direction: true },
];

export class SimpleBot implements BotEngine {
  readonly name: string;

  readonly index: string;

  constructor() {
    const suffix = Math.floor(Math.random() * 10_000);
    this.name = `Bot-${suffix}`;
    this.index = `bot-${suffix}`;
  }

  private randomDirection() {
    return directions[Math.floor(Math.random() * directions.length)];
  }

  private canPlace(startX: number, startY: number, length: number, dx: number, dy: number, blocked: Set<string>): boolean {
    for (let i = 0; i < length; i += 1) {
      const x = startX + dx * i;
      const y = startY + dy * i;
      if (x < 0 || y < 0 || x >= BOARD_SIZE || y >= BOARD_SIZE) {
        return false;
      }
      if (blocked.has(cellKey(x, y))) {
        return false;
      }
    }
    return true;
  }

  private markBlocked(cells: Position[], blocked: Set<string>): void {
    cells.forEach(({ x, y }) => {
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) {
            continue;
          }
          blocked.add(cellKey(nx, ny));
        }
      }
    });
  }

  generateShips(): Ship[] {
    const ships: Ship[] = [];
    const blocked = new Set<string>();

    fleetConfig.forEach((template, idx) => {
      let placed = false;
      let guard = 0;
      while (!placed && guard < 500) {
        guard += 1;
        const dir = this.randomDirection();
        const startX = Math.floor(Math.random() * BOARD_SIZE);
        const startY = Math.floor(Math.random() * BOARD_SIZE);
        if (!this.canPlace(startX, startY, template.length, dir.dx, dir.dy, blocked)) {
          continue;
        }
        const cells: Position[] = [];
        for (let i = 0; i < template.length; i += 1) {
          cells.push({ x: startX + dir.dx * i, y: startY + dir.dy * i });
        }
        this.markBlocked(cells, blocked);
        ships.push({
          type: template.type,
          length: template.length,
          direction: dir.direction,
          position: { x: startX, y: startY },
        });
        placed = true;
      }
      if (!placed) {
        ships.push({
          type: template.type,
          length: template.length,
          direction: false,
          position: { x: 0, y: idx },
        });
      }
    });

    return ships;
  }

  chooseShot(options: Position[]): Position | null {
    if (!options.length) {
      return null;
    }
    const index = Math.floor(Math.random() * options.length);
    return options[index];
  }
}
