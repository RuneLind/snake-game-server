import { z } from "zod";

export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
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
  tickRateMs: z.number().int().min(20).max(1000).optional(),
  arenaRadius: z.number().min(500).max(10000).optional(),
  respawnOnDeath: z.boolean().optional(),
  respawnDelayMs: z.number().int().min(0).max(30000).optional(),
  snakeSpeed: z.number().min(1).max(20).optional(),
  maxTurnRate: z.number().min(0.01).max(0.5).optional(),
});
