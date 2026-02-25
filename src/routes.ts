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
    return getState();
  });

  // --- AI Function Contract Documentation ---

  app.get("/api/docs/ai-contract", {
    schema: {
      description: "Get the AI function contract documentation",
      tags: ["docs"],
    },
  }, async () => {
    return {
      description: "Submit a JavaScript function named 'move' that controls your snake. Return a target point {x, y} or an angle in radians.",
      signature: "function move(state) { return { x, y }; }  // or return angleInRadians;",
      returnValue: {
        option1: "{ x, y } — a target point to move toward (easiest!)",
        option2: "number — a target angle in radians (advanced: 0=right, PI/2=down, PI=left)",
        description: "The snake turns toward the target at ~14 degrees per tick. Errors are shown on the leaderboard.",
      },
      state: {
        you: {
          id: "string — your snake's unique ID",
          x: "number — head X position (0,0 is center of arena)",
          y: "number — head Y position",
          angle: "number — current heading in radians",
          speed: "number — movement speed per tick",
          segments: "[{x, y}, ...] — body segment positions",
          length: "number — segment count (this is your score!)",
        },
        arena: {
          radius: "number — arena radius (circular arena centered at 0,0)",
        },
        snakes: "Array of all snakes: { id, name, x, y, angle, segments, length, alive }",
        food: "Array of food: { x, y, value }",
        tick: "number — current game tick",
      },
      helperFunctions: {
        "angleTo(x1, y1, x2, y2)": "Returns angle from point 1 to point 2 in radians",
        "distTo(x1, y1, x2, y2)": "Returns distance between two points",
        "distFromCenter(x, y)": "Returns distance from arena center (0,0)",
      },
      rules: [
        "Return { x, y } (target point) or a number (angle in radians)",
        "Max execution time: 50ms (exceeded = snake continues straight)",
        "Errors are shown on the leaderboard — check there if your snake goes straight",
        "Snake turns toward target at ~14 degrees per tick",
        "State object is a deep copy — mutations have no effect",
        "No self-collision — you only die from hitting other snakes or the boundary",
      ],
      example: `function move(state) {
  const { x, y } = state.you;
  const arena = state.arena;

  // Stay away from the boundary — head toward center
  if (distFromCenter(x, y) > arena.radius * 0.8) {
    return { x: 0, y: 0 };
  }

  // Find nearest food and go to it
  let nearest = null;
  let nearestDist = Infinity;
  for (const f of state.food) {
    const d = distTo(x, y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = f;
    }
  }

  if (nearest) {
    return { x: nearest.x, y: nearest.y };
  }

  return { x: 0, y: 0 }; // head to center
}`,
    };
  });

  // --- Admin routes ---

  app.post("/api/admin/start", {
    schema: { description: "Start the game loop", tags: ["admin"] },
  }, async () => {
    startGame();
    return { status: "started" };
  });

  app.post("/api/admin/pause", {
    schema: { description: "Pause the game loop", tags: ["admin"] },
  }, async () => {
    pauseGame();
    return { status: "paused" };
  });

  app.post("/api/admin/reset", {
    schema: { description: "Reset the game. Keeps registrations but clears scores.", tags: ["admin"] },
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
    if (!removed) return reply.status(404).send({ error: "Snake not found" });
    return { status: "removed" };
  });

  typedApp.post("/api/admin/config", {
    schema: {
      description: "Update game configuration",
      tags: ["admin"],
      body: AdminConfigSchema,
    },
  }, async (request) => {
    const updates = request.body;
    updateConfig(updates as Record<string, unknown>);
    return { status: "updated", config: updates };
  });
}
