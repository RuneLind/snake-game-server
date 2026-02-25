import { config } from "./config.js";
import type { Direction, Position, Snake, FoodTile, GameState, AIInput } from "./types.js";
import {
  positionKey, isInBounds, movePosition, getOppositeDirection,
  spawnFood, spawnEdgePosition, buildOccupiedSet, randomInt,
} from "./board.js";
import { runAllAIs } from "./runner.js";

let gameState: GameState = createInitialState();
let tickInterval: ReturnType<typeof setInterval> | null = null;
let onTick: ((state: GameState) => void) | null = null;
let onEvent: ((event: string, data: unknown) => void) | null = null;

function createInitialState(): GameState {
  return {
    tick: 0,
    status: "waiting",
    boardWidth: config.boardWidth,
    boardHeight: config.boardHeight,
    snakes: [],
    food: [],
    spectatorCount: 0,
  };
}

export function getState(): GameState {
  return gameState;
}

export function setOnTick(cb: (state: GameState) => void) {
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

export function registerSnake(name: string, aiFunction: string): Snake {
  const existingNames = gameState.snakes.map(s => s.participantName);
  if (existingNames.includes(name)) {
    // Re-register: update AI and respawn
    const existing = gameState.snakes.find(s => s.participantName === name)!;
    existing.aiFunction = aiFunction;
    respawnSnake(existing);
    emitEvent("snake:registered", { name: existing.participantName, color: existing.color });
    return existing;
  }

  const colorIndex = gameState.snakes.length % config.colors.length;
  const snake: Snake = {
    id: generateId(),
    participantName: name,
    color: config.colors[colorIndex],
    segments: [],
    direction: "RIGHT",
    alive: false,
    length: 0,
    score: 0,
    totalScore: 0,
    kills: 0,
    totalKills: 0,
    aiFunction,
  };
  gameState.snakes.push(snake);
  respawnSnake(snake);

  // Ensure minimum food
  ensureMinFood();

  emitEvent("snake:registered", { name: snake.participantName, color: snake.color });
  return snake;
}

function respawnSnake(snake: Snake) {
  const occupiedSet = buildOccupiedSet(
    gameState.snakes.filter(s => s.alive && s.id !== snake.id).map(s => s.segments)
  );
  // Also exclude food positions
  for (const f of gameState.food) {
    occupiedSet.add(positionKey(f.position));
  }

  const spawn = spawnEdgePosition(occupiedSet);
  if (!spawn) {
    // Fallback: spawn at center facing right
    const cx = Math.floor(config.boardWidth / 2);
    const cy = Math.floor(config.boardHeight / 2);
    snake.segments = [];
    for (let i = 0; i < config.startingLength; i++) {
      snake.segments.push({ x: cx - i, y: cy });
    }
    snake.direction = "RIGHT";
  } else {
    // Build snake body along the opposite direction from head
    const segments: Position[] = [spawn.position];
    const opposite = getOppositeDirection(spawn.direction);
    let current = spawn.position;
    for (let i = 0; i < config.startingLength - 1; i++) {
      current = movePosition(current, opposite);
      segments.push(current);
    }
    snake.segments = segments;
    snake.direction = spawn.direction as Direction;
  }

  snake.alive = true;
  snake.length = snake.segments.length;
  snake.score = 0;
  snake.kills = 0;
  snake.diedAt = undefined;
  snake.deathReason = undefined;
  snake.respawnAt = undefined;
}

export function updateSnakeAI(snakeId: string, aiFunction: string): Snake | null {
  const snake = gameState.snakes.find(s => s.id === snakeId);
  if (!snake) return null;

  snake.aiFunction = aiFunction;
  // Kill and respawn immediately
  if (snake.alive) {
    snake.alive = false;
  }
  respawnSnake(snake);
  emitEvent("snake:respawned", { name: snake.participantName });
  return snake;
}

export function removeSnake(snakeId: string): boolean {
  const index = gameState.snakes.findIndex(s => s.id === snakeId);
  if (index === -1) return false;
  gameState.snakes.splice(index, 1);
  return true;
}

function ensureMinFood() {
  const aliveCount = gameState.snakes.filter(s => s.alive).length;
  const minRequired = Math.max(config.minFood, Math.floor(aliveCount / 2));
  const occupiedSet = buildOccupiedSet(gameState.snakes.map(s => s.segments));

  while (gameState.food.length < minRequired) {
    const food = spawnFood(occupiedSet, gameState.food);
    if (!food) break;
    gameState.food.push(food);
  }
}

function buildAIInput(snake: Snake): AIInput {
  return {
    you: {
      id: snake.id,
      head: snake.segments[0],
      segments: [...snake.segments],
      direction: snake.direction,
      length: snake.length,
      score: snake.score,
    },
    board: {
      width: config.boardWidth,
      height: config.boardHeight,
    },
    snakes: gameState.snakes.map(s => ({
      id: s.id,
      name: s.participantName,
      head: s.segments[0],
      segments: [...s.segments],
      direction: s.direction,
      length: s.length,
      alive: s.alive,
    })),
    food: gameState.food.map(f => ({
      position: { ...f.position },
      value: f.value,
    })),
    tick: gameState.tick,
  };
}

async function executeTick() {
  if (gameState.status !== "running") return;

  gameState.tick++;

  // Handle respawning dead snakes in continuous mode
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
    onTick?.(gameState);
    return;
  }

  // 1. Run all AI functions in parallel
  const aiInputs = aliveSnakes.map(s => ({
    id: s.id,
    aiFunction: s.aiFunction,
    input: buildAIInput(s),
  }));

  const directions = await runAllAIs(aiInputs);

  // 2. Apply directions with reversal guard
  for (const snake of aliveSnakes) {
    const dir = directions.get(snake.id);
    if (dir && dir !== getOppositeDirection(snake.direction)) {
      snake.direction = dir;
    }
    // else: keep current direction (null = AI error/timeout, opposite = illegal reversal)
  }

  // 3. Move all snakes simultaneously
  const foodMap = new Map<string, number>(); // key -> index in food array
  gameState.food.forEach((f, i) => foodMap.set(positionKey(f.position), i));

  const newHeads = new Map<string, Position>();
  const ateFood = new Map<string, number>(); // snakeId -> food index

  for (const snake of aliveSnakes) {
    const newHead = movePosition(snake.segments[0], snake.direction);
    newHeads.set(snake.id, newHead);

    // Check if eating food
    const foodKey = positionKey(newHead);
    const foodIndex = foodMap.get(foodKey);
    if (foodIndex !== undefined) {
      ateFood.set(snake.id, foodIndex);
    }
  }

  // Apply movement
  const foodToRemove = new Set<number>();
  for (const snake of aliveSnakes) {
    const newHead = newHeads.get(snake.id)!;
    snake.segments.unshift(newHead);

    if (ateFood.has(snake.id)) {
      const foodIndex = ateFood.get(snake.id)!;
      const foodValue = gameState.food[foodIndex]?.value ?? 1;
      snake.score += foodValue * 10;
      snake.totalScore += foodValue * 10;
      foodToRemove.add(foodIndex);
    } else {
      snake.segments.pop();
    }
    snake.length = snake.segments.length;
  }

  // Remove eaten food
  gameState.food = gameState.food.filter((_, i) => !foodToRemove.has(i));

  // 4. Resolve collisions
  const bodySet = new Map<string, string[]>(); // posKey -> snakeIds whose BODY (not head) is there
  for (const snake of aliveSnakes) {
    for (let i = 1; i < snake.segments.length; i++) {
      const key = positionKey(snake.segments[i]);
      if (!bodySet.has(key)) bodySet.set(key, []);
      bodySet.get(key)!.push(snake.id);
    }
  }

  const deadThisTick = new Set<string>();
  const killedBy = new Map<string, string>(); // deadSnakeId -> killerSnakeId

  for (const snake of aliveSnakes) {
    const head = snake.segments[0];

    // Wall collision
    if (!isInBounds(head)) {
      deadThisTick.add(snake.id);
      snake.deathReason = "wall";
      continue;
    }

    // Body collision (head hits any body segment)
    const key = positionKey(head);
    const bodyOwners = bodySet.get(key);
    if (bodyOwners && bodyOwners.length > 0) {
      deadThisTick.add(snake.id);
      const killer = bodyOwners.find(id => id !== snake.id);
      if (killer) {
        const killerSnake = gameState.snakes.find(s => s.id === killer);
        snake.deathReason = `snake:${killerSnake?.participantName ?? killer}`;
        killedBy.set(snake.id, killer);
      } else {
        snake.deathReason = "self";
      }
    }
  }

  // Head-to-head collisions: both die
  const headPositions = new Map<string, string[]>();
  for (const snake of aliveSnakes) {
    if (deadThisTick.has(snake.id)) continue;
    const key = positionKey(snake.segments[0]);
    if (!headPositions.has(key)) headPositions.set(key, []);
    headPositions.get(key)!.push(snake.id);
  }

  for (const [, snakeIds] of headPositions) {
    if (snakeIds.length > 1) {
      for (const id of snakeIds) {
        deadThisTick.add(id);
        const snake = gameState.snakes.find(s => s.id === id)!;
        const otherNames = snakeIds
          .filter(oid => oid !== id)
          .map(oid => gameState.snakes.find(s => s.id === oid)?.participantName ?? oid);
        snake.deathReason = `headon:${otherNames.join(",")}`;
      }
    }
  }

  // 5. Process deaths
  for (const snakeId of deadThisTick) {
    const snake = gameState.snakes.find(s => s.id === snakeId)!;
    snake.alive = false;
    snake.diedAt = gameState.tick;

    if (config.respawnOnDeath) {
      const respawnTick = gameState.tick + Math.ceil(config.respawnDelayMs / config.tickRateMs);
      snake.respawnAt = respawnTick;
    }

    // Convert body to food (capped)
    for (const segment of snake.segments) {
      if (gameState.food.length >= config.maxFood) break;
      gameState.food.push({ position: { ...segment }, value: 1 });
    }
    snake.segments = [];
    snake.length = 0;

    emitEvent("snake:died", { name: snake.participantName, reason: snake.deathReason });
  }

  // Award kills
  for (const [deadId, killerId] of killedBy) {
    if (deadThisTick.has(killerId)) continue; // dead snakes don't get kill credit
    const killer = gameState.snakes.find(s => s.id === killerId);
    if (killer) {
      killer.kills++;
      killer.totalKills++;
      killer.score += 100;
      killer.totalScore += 100;
    }
  }

  // Survival points
  for (const snake of gameState.snakes.filter(s => s.alive)) {
    snake.score += 1;
    snake.totalScore += 1;
  }

  // Ensure minimum food
  ensureMinFood();

  // Spawn new food to replace eaten food
  const occupiedSet = buildOccupiedSet(gameState.snakes.filter(s => s.alive).map(s => s.segments));
  for (const _ of foodToRemove) {
    if (gameState.food.length >= config.maxFood) break;
    const food = spawnFood(occupiedSet, gameState.food);
    if (food) gameState.food.push(food);
  }

  // 6. Check win condition (tournament mode)
  if (!config.respawnOnDeath) {
    const alive = gameState.snakes.filter(s => s.alive);
    if (alive.length <= 1 && gameState.snakes.length > 1) {
      if (alive.length === 1) {
        alive[0].score += 500;
        alive[0].totalScore += 500;
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

  // 7. Broadcast
  onTick?.(gameState);
}

export function startGame() {
  if (gameState.status === "running") return;
  gameState.status = "running";
  gameState.boardWidth = config.boardWidth;
  gameState.boardHeight = config.boardHeight;

  // Respawn all dead snakes on start
  for (const snake of gameState.snakes) {
    if (!snake.alive) {
      respawnSnake(snake);
    }
  }

  ensureMinFood();
  emitEvent("game:started", {});

  tickInterval = setInterval(() => {
    executeTick();
  }, config.tickRateMs);
}

export function pauseGame() {
  if (gameState.status !== "running") return;
  gameState.status = "paused";
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  emitEvent("game:paused", {});
}

export function stopGame() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export function resetGame() {
  stopGame();
  const snakes = gameState.snakes;
  gameState = createInitialState();
  // Keep registrations but reset stats
  for (const snake of snakes) {
    snake.score = 0;
    snake.totalScore = 0;
    snake.kills = 0;
    snake.totalKills = 0;
    snake.alive = false;
    snake.diedAt = undefined;
    snake.deathReason = undefined;
    snake.respawnAt = undefined;
    snake.segments = [];
    snake.length = 0;
    gameState.snakes.push(snake);
  }
  emitEvent("game:reset", {});
}

export function updateConfig(updates: Record<string, unknown>) {
  if (updates.tickRateMs !== undefined) config.tickRateMs = updates.tickRateMs as number;
  if (updates.boardWidth !== undefined) config.boardWidth = updates.boardWidth as number;
  if (updates.boardHeight !== undefined) config.boardHeight = updates.boardHeight as number;
  if (updates.respawnOnDeath !== undefined) config.respawnOnDeath = updates.respawnOnDeath as boolean;
  if (updates.respawnDelayMs !== undefined) config.respawnDelayMs = updates.respawnDelayMs as number;

  // If game is running, restart the interval with new tick rate
  if (gameState.status === "running" && updates.tickRateMs !== undefined) {
    if (tickInterval) clearInterval(tickInterval);
    tickInterval = setInterval(() => {
      executeTick();
    }, config.tickRateMs);
  }
}
