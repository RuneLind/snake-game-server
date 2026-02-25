import { z } from "zod";

export const DirectionSchema = z.enum(["UP", "DOWN", "LEFT", "RIGHT"]);

export const PositionSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export const RegisterSchema = z.object({
  name: z.string().min(1).max(20),
  aiFunction: z.string().min(1).max(10000),
});

export const SubmitSchema = z.object({
  snakeId: z.string().min(1),
  aiFunction: z.string().min(1).max(10000),
});

export const AdminConfigSchema = z.object({
  tickRateMs: z.number().int().min(50).max(1000).optional(),
  boardWidth: z.number().int().min(10).max(100).optional(),
  boardHeight: z.number().int().min(10).max(100).optional(),
  respawnOnDeath: z.boolean().optional(),
  respawnDelayMs: z.number().int().min(0).max(30000).optional(),
});

export const SnakeResponseSchema = z.object({
  id: z.string(),
  participantName: z.string(),
  color: z.string(),
  segments: z.array(PositionSchema),
  direction: DirectionSchema,
  alive: z.boolean(),
  length: z.number(),
  score: z.number(),
  totalScore: z.number(),
  kills: z.number(),
  totalKills: z.number(),
});

export const FoodTileSchema = z.object({
  position: PositionSchema,
  value: z.number(),
});

export const GameStateResponseSchema = z.object({
  tick: z.number(),
  status: z.enum(["waiting", "running", "paused", "finished"]),
  boardWidth: z.number(),
  boardHeight: z.number(),
  snakes: z.array(SnakeResponseSchema),
  food: z.array(FoodTileSchema),
  winnerId: z.string().optional(),
  spectatorCount: z.number(),
});
