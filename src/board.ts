import { config } from "./config.js";
import type { Position, FoodTile } from "./types.js";

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min;
}

export function positionKey(p: Position): string {
  return `${p.x},${p.y}`;
}

export function isInBounds(p: Position): boolean {
  return p.x >= 0 && p.x < config.boardWidth && p.y >= 0 && p.y < config.boardHeight;
}

export function movePosition(p: Position, direction: string): Position {
  switch (direction) {
    case "UP":    return { x: p.x, y: p.y - 1 };
    case "DOWN":  return { x: p.x, y: p.y + 1 };
    case "LEFT":  return { x: p.x - 1, y: p.y };
    case "RIGHT": return { x: p.x + 1, y: p.y };
    default:      return p;
  }
}

export function getOppositeDirection(dir: string): string {
  const opposites: Record<string, string> = {
    UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT",
  };
  return opposites[dir] ?? dir;
}

export function spawnFood(occupiedSet: Set<string>, existingFood: FoodTile[]): FoodTile | null {
  const foodSet = new Set(existingFood.map(f => positionKey(f.position)));
  const allOccupied = new Set([...occupiedSet, ...foodSet]);

  // Try random positions up to 100 times
  for (let i = 0; i < 100; i++) {
    const pos: Position = {
      x: randomInt(0, config.boardWidth),
      y: randomInt(0, config.boardHeight),
    };
    if (!allOccupied.has(positionKey(pos))) {
      return { position: pos, value: 1 };
    }
  }
  return null;
}

export function spawnEdgePosition(occupiedSet: Set<string>): {
  position: Position;
  direction: string;
} | null {
  // Head spawns a few cells inward from the edge so the body extends to the edge
  const inset = config.startingLength - 1;
  const edges: Array<{ pos: () => Position; dir: string }> = [
    { pos: () => ({ x: inset, y: randomInt(2, config.boardHeight - 2) }), dir: "RIGHT" },
    { pos: () => ({ x: config.boardWidth - 1 - inset, y: randomInt(2, config.boardHeight - 2) }), dir: "LEFT" },
    { pos: () => ({ x: randomInt(2, config.boardWidth - 2), y: inset }), dir: "DOWN" },
    { pos: () => ({ x: randomInt(2, config.boardWidth - 2), y: config.boardHeight - 1 - inset }), dir: "UP" },
  ];

  for (let attempt = 0; attempt < 50; attempt++) {
    const edge = edges[randomInt(0, edges.length)];
    const pos = edge.pos();
    // Check the spawn point and a few cells inward for the starting body
    const segments: Position[] = [pos];
    let valid = true;
    let current = pos;
    const opposite = getOppositeDirection(edge.dir);
    for (let i = 0; i < config.startingLength - 1; i++) {
      current = movePosition(current, opposite);
      if (!isInBounds(current)) { valid = false; break; }
      segments.push(current);
    }
    if (!valid) continue;

    const allClear = segments.every(s => !occupiedSet.has(positionKey(s)));
    if (allClear) {
      return { position: pos, direction: edge.dir };
    }
  }
  return null;
}

export function buildOccupiedSet(snakeSegments: Position[][]): Set<string> {
  const set = new Set<string>();
  for (const segments of snakeSegments) {
    for (const s of segments) {
      set.add(positionKey(s));
    }
  }
  return set;
}
