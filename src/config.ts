export const config = {
  arenaRadius: 2000,
  tickRateMs: 50,           // 20 ticks/second
  snakeSpeed: 4,            // units per tick
  snakeRadius: 12,          // body segment radius
  segmentSpacing: 20,       // distance between segment centers
  maxTurnRate: 0.25,        // radians per tick (~14 degrees, responsive turning)
  startingSegments: 10,
  foodRadius: 6,
  minFood: 200,
  maxFood: 600,
  respawnOnDeath: true,
  respawnDelayMs: 3000,
  aiTimeoutMs: 50,
  colors: [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
    "#00bcd4", "#8bc34a", "#ff5722", "#607d8b",
  ],
};
