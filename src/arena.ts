import { config } from "./config.js";
import type { Position, Snake, Food } from "./types.js";

// --- Angle math ---

export function normalizeAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a;
}

export function angleDiff(from: number, to: number): number {
  let diff = to - from;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

export function turnToward(current: number, target: number, maxRate: number): number {
  const diff = angleDiff(current, target);
  if (Math.abs(diff) <= maxRate) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(diff) * maxRate);
}

// --- Distance ---

export function distSq(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(distSq(x1, y1, x2, y2));
}

// --- Boundary ---

export function isInBounds(x: number, y: number): boolean {
  return x * x + y * y < config.arenaRadius * config.arenaRadius;
}

// --- Segment computation ---

export function getSegmentPositions(snake: Snake): Position[] {
  if (snake.trail.length === 0) return [];

  const positions: Position[] = [];
  const spacing = config.segmentSpacing;

  positions.push(snake.trail[0]); // head
  let distAccum = 0;

  for (let i = 1; i < snake.trail.length && positions.length < snake.segmentCount; i++) {
    const dx = snake.trail[i].x - snake.trail[i - 1].x;
    const dy = snake.trail[i].y - snake.trail[i - 1].y;
    distAccum += Math.sqrt(dx * dx + dy * dy);

    if (distAccum >= spacing) {
      // Interpolate to exact spacing point
      const overshoot = distAccum - spacing;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen > 0) {
        const t = overshoot / segLen;
        positions.push({
          x: snake.trail[i].x + t * (snake.trail[i - 1].x - snake.trail[i].x),
          y: snake.trail[i].y + t * (snake.trail[i - 1].y - snake.trail[i].y),
        });
      } else {
        positions.push(snake.trail[i]);
      }
      distAccum = overshoot;
    }
  }

  return positions;
}

export function pruneTrail(snake: Snake) {
  const maxDist = (snake.segmentCount + 5) * config.segmentSpacing;
  let totalDist = 0;

  for (let i = 1; i < snake.trail.length; i++) {
    const dx = snake.trail[i].x - snake.trail[i - 1].x;
    const dy = snake.trail[i].y - snake.trail[i - 1].y;
    totalDist += Math.sqrt(dx * dx + dy * dy);
    if (totalDist > maxDist) {
      snake.trail.length = i + 1;
      return;
    }
  }
}

// --- Spawning ---

export function spawnSnakePosition(): { x: number; y: number; angle: number } {
  const spawnAngle = Math.random() * 2 * Math.PI;
  const spawnRadius = config.arenaRadius * (0.5 + Math.random() * 0.3);

  const x = Math.cos(spawnAngle) * spawnRadius;
  const y = Math.sin(spawnAngle) * spawnRadius;

  // Face roughly toward center with some randomness
  const toCenter = Math.atan2(-y, -x);
  const angle = normalizeAngle(toCenter + (Math.random() - 0.5) * Math.PI * 0.5);

  return { x, y, angle };
}

export function buildInitialTrail(headX: number, headY: number, angle: number): Position[] {
  const trail: Position[] = [];
  const backAngle = angle + Math.PI;
  const step = config.segmentSpacing / 2;

  const count = config.startingSegments * 3;
  for (let i = 0; i < count; i++) {
    const d = i * step;
    trail.push({
      x: headX + Math.cos(backAngle) * d,
      y: headY + Math.sin(backAngle) * d,
    });
  }
  return trail;
}

export function spawnFood(): Food {
  const angle = Math.random() * 2 * Math.PI;
  const r = config.arenaRadius * Math.sqrt(Math.random()) * 0.95;
  return {
    x: Math.cos(angle) * r,
    y: Math.sin(angle) * r,
    value: 1,
    radius: config.foodRadius,
  };
}

// --- Rounding for broadcast ---

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
