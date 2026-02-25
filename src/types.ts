export interface Position {
  x: number;
  y: number;
}

export interface Snake {
  id: string;
  participantName: string;
  color: string;
  alive: boolean;

  // Movement
  headX: number;
  headY: number;
  angle: number;        // current heading in radians
  speed: number;        // units per tick

  // Body
  trail: Position[];    // trail[0] = most recent head position
  segmentCount: number; // how many visible segments

  // Scoring
  score: number;
  totalScore: number;
  kills: number;
  totalKills: number;

  // AI
  aiFunction: string;

  // Death
  diedAt?: number;
  deathReason?: string;
  respawnAt?: number;
}

export interface Food {
  x: number;
  y: number;
  value: number;
  radius: number;
}

export interface GameState {
  tick: number;
  status: "waiting" | "running" | "paused" | "finished";
  arenaRadius: number;
  snakes: Snake[];
  food: Food[];
  winnerId?: string;
  spectatorCount: number;
}

export interface AIInput {
  you: {
    id: string;
    x: number;
    y: number;
    angle: number;
    speed: number;
    segments: Position[];
    length: number;
    score: number;
  };
  arena: {
    radius: number;
  };
  snakes: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    angle: number;
    segments: Position[];
    length: number;
    alive: boolean;
  }>;
  food: Array<{
    x: number;
    y: number;
    value: number;
  }>;
  tick: number;
}
