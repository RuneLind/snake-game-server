import { config } from "./config.js";
import type { Position, Snake, Food, GameState, AIInput } from "./types.js";
import {
  normalizeAngle, turnToward, distSq, isInBounds,
  getSegmentPositions, pruneTrail, spawnSnakePosition,
  buildInitialTrail, spawnFood, round1, round2,
} from "./arena.js";
import { runAllAIs } from "./runner.js";
import { saveState } from "./persistence.js";

let gameState: GameState = createInitialState();
let tickInterval: ReturnType<typeof setTimeout> | null = null;
let saveInterval: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;
let onTick: ((state: unknown) => void) | null = null;
let onEvent: ((event: string, data: unknown) => void) | null = null;

function createInitialState(): GameState {
  return {
    tick: 0,
    status: "waiting",
    arenaRadius: config.arenaRadius,
    snakes: [],
    food: [],
    spectatorCount: 0,
  };
}

export function getState(): GameState {
  return gameState;
}

export function setOnTick(cb: (state: unknown) => void) {
  onTick = cb;
}

export function setOnEvent(cb: (event: string, data: unknown) => void) {
  onEvent = cb;
}

function emitEvent(event: string, data: unknown) {
  onEvent?.(event, data);
}

export function setSpectatorCount(count: number) {
  gameState.spectatorCount = count;
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// --- Registration ---

export function registerSnake(name: string, aiFunction: string): Snake {
  const existing = gameState.snakes.find(s => s.participantName === name);
  if (existing) {
    existing.aiFunction = aiFunction;
    existing.submissions.push({
      tick: gameState.tick,
      lines: aiFunction.split('\n').length,
      timestamp: Date.now(),
    });
    respawnSnake(existing);
    emitEvent("snake:registered", { name: existing.participantName, color: existing.color });
    scheduleSave();
    return existing;
  }

  const colorIndex = gameState.snakes.length % config.colors.length;
  const snake: Snake = {
    id: generateId(),
    participantName: name,
    color: config.colors[colorIndex],
    alive: false,
    headX: 0,
    headY: 0,
    angle: 0,
    speed: config.snakeSpeed,
    trail: [],
    segmentCount: config.startingSegments,
    kills: 0,
    totalKills: 0,
    deaths: 0,
    bestLength: 0,
    submissions: [{
      tick: gameState.tick,
      lines: aiFunction.split('\n').length,
      timestamp: Date.now(),
    }],
    aiFunction,
  };
  gameState.snakes.push(snake);
  respawnSnake(snake);
  ensureMinFood();

  emitEvent("snake:registered", { name: snake.participantName, color: snake.color });
  scheduleSave();
  return snake;
}

function respawnSnake(snake: Snake) {
  const spawn = spawnSnakePosition();
  snake.headX = spawn.x;
  snake.headY = spawn.y;
  snake.angle = spawn.angle;
  snake.speed = config.snakeSpeed;
  snake.trail = buildInitialTrail(spawn.x, spawn.y, spawn.angle);
  snake.segmentCount = config.startingSegments;
  snake.alive = true;
  snake.kills = 0;
  snake.diedAt = undefined;
  snake.deathReason = undefined;
  snake.respawnAt = undefined;
  snake.lastAIError = undefined;
}

export function updateSnakeAI(snakeId: string, aiFunction: string): Snake | null {
  const snake = gameState.snakes.find(s => s.id === snakeId);
  if (!snake) return null;

  snake.aiFunction = aiFunction;
  snake.submissions.push({
    tick: gameState.tick,
    lines: aiFunction.split('\n').length,
    timestamp: Date.now(),
  });
  if (snake.alive) snake.alive = false;
  respawnSnake(snake);
  emitEvent("snake:respawned", { name: snake.participantName });
  scheduleSave();
  return snake;
}

export function removeSnake(snakeId: string): boolean {
  const index = gameState.snakes.findIndex(s => s.id === snakeId);
  if (index === -1) return false;
  gameState.snakes.splice(index, 1);
  return true;
}

// --- Food ---

function ensureMinFood() {
  const target = config.minFood + gameState.snakes.length * 20;
  const cap = config.maxFood;
  while (gameState.food.length < Math.min(target, cap)) {
    gameState.food.push(spawnFood());
  }
}

// --- AI Input ---

function buildAIInput(snake: Snake): AIInput {
  const segments = getSegmentPositions(snake);
  return {
    you: {
      id: snake.id,
      x: snake.headX,
      y: snake.headY,
      angle: snake.angle,
      speed: snake.speed,
      segments,
      length: snake.segmentCount,
    },
    arena: {
      radius: config.arenaRadius,
    },
    snakes: gameState.snakes.map(s => ({
      id: s.id,
      name: s.participantName,
      x: s.headX,
      y: s.headY,
      angle: s.angle,
      segments: s.alive ? getSegmentPositions(s) : [],
      length: s.segmentCount,
      alive: s.alive,
    })),
    food: gameState.food.map(f => ({
      x: f.x,
      y: f.y,
      value: f.value,
    })),
    tick: gameState.tick,
  };
}

// --- Tick ---

async function executeTick() {
  if (gameState.status !== "running") return;
  if (tickRunning) return; // prevent overlap
  tickRunning = true;

  gameState.tick++;

  // 1. Handle respawns
  if (config.respawnOnDeath) {
    for (const snake of gameState.snakes) {
      if (!snake.alive && snake.respawnAt && gameState.tick >= snake.respawnAt) {
        respawnSnake(snake);
        emitEvent("snake:respawned", { name: snake.participantName });
      }
    }
  }

  const aliveSnakes = gameState.snakes.filter(s => s.alive);
  if (aliveSnakes.length === 0) {
    broadcastState();
    tickRunning = false;
    scheduleTick();
    return;
  }

  // 2. Run all AI functions
  const aiInputs = aliveSnakes.map(s => ({
    id: s.id,
    aiFunction: s.aiFunction,
    input: buildAIInput(s),
  }));
  const aiResults = await runAllAIs(aiInputs);

  // 3. Turn toward target angle + track errors
  for (const snake of aliveSnakes) {
    const result = aiResults.get(snake.id);
    if (result) {
      snake.lastAIError = result.error ?? undefined;
      if (result.targetAngle !== null) {
        snake.angle = turnToward(snake.angle, normalizeAngle(result.targetAngle), config.maxTurnRate);
      }
    }
  }

  // 4. Move heads
  for (const snake of aliveSnakes) {
    snake.headX += Math.cos(snake.angle) * snake.speed;
    snake.headY += Math.sin(snake.angle) * snake.speed;
    snake.trail.unshift({ x: snake.headX, y: snake.headY });
    pruneTrail(snake);
  }

  // 5. Compute segment positions for collision
  const segmentCache = new Map<string, Position[]>();
  for (const snake of aliveSnakes) {
    segmentCache.set(snake.id, getSegmentPositions(snake));
  }

  // 6. Check food collisions
  const eatenIndices = new Set<number>();
  for (const snake of aliveSnakes) {
    const eatThresholdSq = (config.snakeRadius + config.foodRadius) ** 2;
    for (let i = 0; i < gameState.food.length; i++) {
      if (eatenIndices.has(i)) continue;
      const food = gameState.food[i];
      if (distSq(snake.headX, snake.headY, food.x, food.y) < eatThresholdSq) {
        eatenIndices.add(i);
        snake.segmentCount += food.value;
        if (snake.segmentCount > snake.bestLength) {
          snake.bestLength = snake.segmentCount;
        }
      }
    }
  }
  if (eatenIndices.size > 0) {
    gameState.food = gameState.food.filter((_, i) => !eatenIndices.has(i));
  }

  // 7. Check death collisions
  const deadThisTick = new Set<string>();
  const killedBy = new Map<string, string>();

  for (const snake of aliveSnakes) {
    // Boundary check
    if (!isInBounds(snake.headX, snake.headY)) {
      deadThisTick.add(snake.id);
      snake.deathReason = "boundary";
      continue;
    }

    // Head vs other snake segments (no self-collision)
    const collisionDistSq = (config.snakeRadius * 2) ** 2;
    for (const other of aliveSnakes) {
      if (other.id === snake.id) continue;
      const otherSegs = segmentCache.get(other.id)!;
      // Skip head (index 0) of other — that's head-to-head, handled below
      for (let i = 1; i < otherSegs.length; i++) {
        if (distSq(snake.headX, snake.headY, otherSegs[i].x, otherSegs[i].y) < collisionDistSq) {
          deadThisTick.add(snake.id);
          snake.deathReason = `snake:${other.participantName}`;
          killedBy.set(snake.id, other.id);
          break;
        }
      }
      if (deadThisTick.has(snake.id)) break;
    }
  }

  // Head-to-head collisions
  const headCollisionDistSq = (config.snakeRadius * 2) ** 2;
  for (let i = 0; i < aliveSnakes.length; i++) {
    for (let j = i + 1; j < aliveSnakes.length; j++) {
      const a = aliveSnakes[i];
      const b = aliveSnakes[j];
      if (deadThisTick.has(a.id) || deadThisTick.has(b.id)) continue;
      if (distSq(a.headX, a.headY, b.headX, b.headY) < headCollisionDistSq) {
        deadThisTick.add(a.id);
        deadThisTick.add(b.id);
        a.deathReason = `headon:${b.participantName}`;
        b.deathReason = `headon:${a.participantName}`;
      }
    }
  }

  // 8. Process deaths
  for (const snakeId of deadThisTick) {
    const snake = gameState.snakes.find(s => s.id === snakeId)!;
    snake.alive = false;
    snake.deaths++;
    snake.diedAt = gameState.tick;

    if (config.respawnOnDeath) {
      snake.respawnAt = gameState.tick + Math.ceil(config.respawnDelayMs / config.tickRateMs);
    }

    // Convert body to food
    const segments = segmentCache.get(snake.id) ?? [];
    const foodCount = Math.floor(segments.length * 0.5);
    for (let i = 0; i < foodCount && gameState.food.length < config.maxFood; i++) {
      const seg = segments[Math.floor(i * segments.length / foodCount)];
      gameState.food.push({
        x: seg.x + (Math.random() - 0.5) * 10,
        y: seg.y + (Math.random() - 0.5) * 10,
        value: 2,
        radius: config.foodRadius * 1.5,
      });
    }

    snake.trail = [];
    emitEvent("snake:died", { name: snake.participantName, reason: snake.deathReason });
    scheduleSave();
  }

  // 9. Award kills
  for (const [deadId, killerId] of killedBy) {
    if (deadThisTick.has(killerId)) continue;
    const killer = gameState.snakes.find(s => s.id === killerId);
    if (killer) {
      killer.kills++;
      killer.totalKills++;
    }
  }

  // 10. Ensure min food + replace eaten
  ensureMinFood();

  // 11. Check win condition (tournament mode)
  if (!config.respawnOnDeath) {
    const alive = gameState.snakes.filter(s => s.alive);
    if (alive.length <= 1 && gameState.snakes.length > 1) {
      if (alive.length === 1) {
        gameState.winnerId = alive[0].id;
      }
      gameState.status = "finished";
      emitEvent("game:finished", {
        winnerId: gameState.winnerId,
        winnerName: alive[0]?.participantName ?? "Nobody",
      });
      stopGame();
    }
  }

  // 12. Broadcast
  broadcastState();
  tickRunning = false;
  scheduleTick();
}

function broadcastState() {
  if (!onTick) return;

  const state = {
    tick: gameState.tick,
    status: gameState.status,
    arenaRadius: config.arenaRadius,
    snakes: gameState.snakes.map(s => {
      // Thin segments for broadcast — every 3rd point is enough for smooth line rendering
      const allSegs = s.alive ? getSegmentPositions(s) : [];
      const segments: Array<{x: number, y: number}> = [];
      for (let i = 0; i < allSegs.length; i++) {
        if (i === 0 || i === allSegs.length - 1 || i % 3 === 0) {
          segments.push({ x: round1(allSegs[i].x), y: round1(allSegs[i].y) });
        }
      }
      return {
        id: s.id,
        participantName: s.participantName,
        color: s.color,
        alive: s.alive,
        x: round1(s.headX),
        y: round1(s.headY),
        angle: round2(s.angle),
        speed: s.speed,
        segments,
        length: s.segmentCount,
        bestLength: s.bestLength,
        kills: s.kills,
        totalKills: s.totalKills,
        deaths: s.deaths,
        deathReason: s.deathReason,
        lastAIError: s.lastAIError,
        submissionCount: s.submissions.length,
        latestLines: s.submissions.length > 0 ? s.submissions[s.submissions.length - 1].lines : 0,
      };
    }),
    food: gameState.food.map(f => ({
      x: round1(f.x),
      y: round1(f.y),
      value: f.value,
    })),
    spectatorCount: gameState.spectatorCount,
  };

  onTick(state);
}

// --- Game control ---

export function startGame() {
  if (gameState.status === "running") return;
  gameState.status = "running";
  gameState.arenaRadius = config.arenaRadius;

  for (const snake of gameState.snakes) {
    if (!snake.alive) respawnSnake(snake);
  }

  ensureMinFood();
  emitEvent("game:started", {});

  scheduleTick();
}

function scheduleTick() {
  if (tickInterval) clearTimeout(tickInterval);
  if (gameState.status !== "running") return;
  tickInterval = setTimeout(() => { executeTick(); }, config.tickRateMs);
}

export function pauseGame() {
  if (gameState.status !== "running") return;
  gameState.status = "paused";
  if (tickInterval) {
    clearTimeout(tickInterval);
    tickInterval = null;
  }
  emitEvent("game:paused", {});
}

export function stopGame() {
  if (tickInterval) {
    clearTimeout(tickInterval);
    tickInterval = null;
  }
}

export function resetGame() {
  stopGame();
  const snakes = gameState.snakes;
  gameState = createInitialState();
  for (const snake of snakes) {
    snake.kills = 0;
    snake.totalKills = 0;
    snake.deaths = 0;
    snake.bestLength = 0;
    snake.submissions = [];
    snake.alive = false;
    snake.diedAt = undefined;
    snake.deathReason = undefined;
    snake.respawnAt = undefined;
    snake.trail = [];
    gameState.snakes.push(snake);
  }
  emitEvent("game:reset", {});
}

// --- Persistence ---

let savePending = false;

function scheduleSave() {
  if (savePending) return;
  savePending = true;
  queueMicrotask(() => {
    savePending = false;
    saveState(getStateForPersistence());
  });
}

export function getStateForPersistence() {
  return {
    tick: gameState.tick,
    status: gameState.status,
    snakes: gameState.snakes.map(s => ({
      id: s.id,
      participantName: s.participantName,
      color: s.color,
      aiFunction: s.aiFunction,
      submissions: s.submissions,
      totalKills: s.totalKills,
      deaths: s.deaths,
      bestLength: s.bestLength,
    })),
    food: gameState.food,
  };
}

export function loadState(saved: ReturnType<typeof getStateForPersistence>) {
  gameState.tick = saved.tick;
  gameState.status = "waiting"; // always start paused after restore
  gameState.food = saved.food;
  for (const ss of saved.snakes) {
    const snake: Snake = {
      id: ss.id,
      participantName: ss.participantName,
      color: ss.color,
      alive: false,
      headX: 0,
      headY: 0,
      angle: 0,
      speed: config.snakeSpeed,
      trail: [],
      segmentCount: config.startingSegments,
      kills: 0,
      totalKills: ss.totalKills,
      deaths: ss.deaths,
      bestLength: ss.bestLength,
      submissions: ss.submissions,
      aiFunction: ss.aiFunction,
    };
    gameState.snakes.push(snake);
    respawnSnake(snake);
  }
  ensureMinFood();
}

export function startPeriodicSave() {
  if (saveInterval) clearInterval(saveInterval);
  saveInterval = setInterval(() => {
    saveState(getStateForPersistence());
  }, 30_000);
}

export function updateConfig(updates: Record<string, unknown>) {
  if (updates.tickRateMs !== undefined) config.tickRateMs = updates.tickRateMs as number;
  if (updates.arenaRadius !== undefined) config.arenaRadius = updates.arenaRadius as number;
  if (updates.respawnOnDeath !== undefined) config.respawnOnDeath = updates.respawnOnDeath as boolean;
  if (updates.respawnDelayMs !== undefined) config.respawnDelayMs = updates.respawnDelayMs as number;
  if (updates.snakeSpeed !== undefined) config.snakeSpeed = updates.snakeSpeed as number;
  if (updates.maxTurnRate !== undefined) config.maxTurnRate = updates.maxTurnRate as number;

  if (gameState.status === "running" && updates.tickRateMs !== undefined) {
    scheduleTick();
  }
}
