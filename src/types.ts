export type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT";

export interface Position {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  participantName: string;
  color: string;
  segments: Position[];
  direction: Direction;
  alive: boolean;
  length: number;
  score: number;
  totalScore: number;
  kills: number;
  totalKills: number;
  aiFunction: string;
  diedAt?: number;
  deathReason?: string;
  respawnAt?: number;
}

export interface FoodTile {
  position: Position;
  value: number;
}

export interface GameState {
  tick: number;
  status: "waiting" | "running" | "paused" | "finished";
  boardWidth: number;
  boardHeight: number;
  snakes: Snake[];
  food: FoodTile[];
  winnerId?: string;
  spectatorCount: number;
}

export interface AIInput {
  you: {
    id: string;
    head: Position;
    segments: Position[];
    direction: Direction;
    length: number;
    score: number;
  };
  board: {
    width: number;
    height: number;
  };
  snakes: Array<{
    id: string;
    name: string;
    head: Position;
    segments: Position[];
    direction: Direction;
    length: number;
    alive: boolean;
  }>;
  food: Array<{
    position: Position;
    value: number;
  }>;
  tick: number;
}
