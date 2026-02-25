import type { FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import {
  RegisterSchema,
  SubmitSchema,
  AdminConfigSchema,
} from "./schemas.js";
import { z } from "zod";
import {
  getState,
  registerSnake,
  updateSnakeAI,
  removeSnake,
  startGame,
  pauseGame,
  resetGame,
  updateConfig,
} from "./game.js";

export async function registerRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  // --- Participant routes ---

  typedApp.post("/api/register", {
    schema: {
      description: "Register a participant and submit their initial AI function",
      tags: ["participant"],
      body: RegisterSchema,
    },
  }, async (request, reply) => {
    const { name, aiFunction } = request.body;
    const snake = registerSnake(name, aiFunction);
    return reply.send({
      snakeId: snake.id,
      color: snake.color,
      message: `Registered as ${snake.participantName}! Your snake is on the board.`,
    });
  });

  typedApp.post("/api/submit", {
    schema: {
      description: "Update AI function for an existing snake. Snake is killed and respawned with new AI immediately.",
      tags: ["participant"],
      body: SubmitSchema,
    },
  }, async (request, reply) => {
    const { snakeId, aiFunction } = request.body;
    const snake = updateSnakeAI(snakeId, aiFunction);
    if (!snake) {
      return reply.status(404).send({ error: "Snake not found" });
    }
    return reply.send({
      status: "updated",
      message: "Snake respawned with new AI.",
    });
  });

  app.get("/api/state", {
    schema: {
      description: "Get current full game state (for debugging)",
      tags: ["participant"],
    },
  }, async () => {
    const state = getState();
    return {
      ...state,
      snakes: state.snakes.map(s => ({
        id: s.id,
        participantName: s.participantName,
        color: s.color,
        segments: s.segments,
        direction: s.direction,
        alive: s.alive,
        length: s.length,
        score: s.score,
        totalScore: s.totalScore,
        kills: s.kills,
        totalKills: s.totalKills,
        diedAt: s.diedAt,
        deathReason: s.deathReason,
      })),
    };
  });

  // --- AI Function Contract Documentation ---

  app.get("/api/docs/ai-contract", {
    schema: {
      description: "Get the AI function contract documentation",
      tags: ["docs"],
    },
  }, async () => {
    return {
      description: "Submit a JavaScript function named 'move' that controls your snake.",
      signature: "function move(state) { return 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'; }",
      state: {
        you: {
          id: "string — your snake's unique ID",
          head: "{ x, y } — your head position (0,0 is top-left)",
          segments: "[{ x, y }, ...] — all body segments, segments[0] is head",
          direction: "'UP' | 'DOWN' | 'LEFT' | 'RIGHT' — current travel direction",
          length: "number — current body length",
          score: "number — current score",
        },
        board: {
          width: "number — board width in cells",
          height: "number — board height in cells",
        },
        snakes: "Array of all snakes: { id, name, head, segments, direction, length, alive }",
        food: "Array of food tiles: { position: { x, y }, value: number }",
        tick: "number — current game tick",
      },
      rules: [
        "Function must return synchronously",
        "Max execution time: 50ms (exceeded = snake goes straight)",
        "Returning opposite direction (180° reversal) is ignored",
        "Runtime errors = snake goes straight that tick",
        "State object is a deep copy — mutations have no effect",
      ],
      example: `function move(state) {
  const { head, direction } = state.you;
  const { width, height } = state.board;

  const occupied = new Set(
    state.snakes
      .filter(s => s.alive)
      .flatMap(s => s.segments)
      .map(p => \`\${p.x},\${p.y}\`)
  );

  const options = ["UP", "DOWN", "LEFT", "RIGHT"];
  const opposites = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

  const next = (pos, dir) => ({
    UP:    { x: pos.x,     y: pos.y - 1 },
    DOWN:  { x: pos.x,     y: pos.y + 1 },
    LEFT:  { x: pos.x - 1, y: pos.y     },
    RIGHT: { x: pos.x + 1, y: pos.y     },
  })[dir];

  const safe = (pos) =>
    pos.x >= 0 && pos.x < width &&
    pos.y >= 0 && pos.y < height &&
    !occupied.has(\`\${pos.x},\${pos.y}\`);

  for (const dir of [direction, ...options]) {
    if (dir === opposites[direction]) continue;
    if (safe(next(head, dir))) return dir;
  }

  return direction;
}`,
    };
  });

  // --- Admin routes ---

  app.post("/api/admin/start", {
    schema: {
      description: "Start the game loop",
      tags: ["admin"],
    },
  }, async () => {
    startGame();
    return { status: "started" };
  });

  app.post("/api/admin/pause", {
    schema: {
      description: "Pause the game loop",
      tags: ["admin"],
    },
  }, async () => {
    pauseGame();
    return { status: "paused" };
  });

  app.post("/api/admin/reset", {
    schema: {
      description: "Reset the game. Keeps registrations but clears scores and respawns all snakes.",
      tags: ["admin"],
    },
  }, async () => {
    resetGame();
    return { status: "reset" };
  });

  app.delete("/api/admin/snake/:id", {
    schema: {
      description: "Remove a snake from the game (kick)",
      tags: ["admin"],
      params: z.object({ id: z.string() }),
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = removeSnake(id);
    if (!removed) {
      return reply.status(404).send({ error: "Snake not found" });
    }
    return { status: "removed" };
  });

  typedApp.post("/api/admin/config", {
    schema: {
      description: "Update game configuration (tick rate, board size, etc.)",
      tags: ["admin"],
      body: AdminConfigSchema,
    },
  }, async (request) => {
    const updates = request.body;
    updateConfig(updates as Record<string, unknown>);
    return { status: "updated", config: updates };
  });
}
