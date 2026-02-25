import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import {
  jsonSchemaTransform,
} from "fastify-type-provider-zod";
import { Server } from "socket.io";
import { resolve } from "path";
import { registerRoutes } from "./routes.js";
import { getState, setOnTick, setOnEvent, setSpectatorCount, loadState, startPeriodicSave } from "./game.js";
import { loadSavedState } from "./persistence.js";

const app = Fastify({ logger: true });

// CORS
await app.register(fastifyCors, { origin: true });

// Swagger
await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: "Snake AI Game Server",
      description: "Multiplayer snake game where AI functions control the snakes",
      version: "1.0.0",
    },
    tags: [
      { name: "participant", description: "Participant endpoints" },
      { name: "admin", description: "Admin game control" },
      { name: "docs", description: "Documentation" },
    ],
  },
  transform: jsonSchemaTransform,
});

await app.register(fastifySwaggerUi, {
  routePrefix: "/docs",
});

// Routes (must be registered before static files)
await registerRoutes(app);

// Static files (wildcard false so API routes take priority)
await app.register(fastifyStatic, {
  root: resolve(import.meta.dir, "../public"),
  prefix: "/",
  wildcard: false,
});

// Restore persisted state
const saved = await loadSavedState();
if (saved) {
  try {
    loadState(saved);
    console.log(`Restored state: ${(saved as any).snakes?.length ?? 0} snakes, tick ${(saved as any).tick}`);
  } catch (err) {
    console.error("Failed to restore saved state, starting fresh:", err);
  }
} else {
  console.log("Starting fresh — no saved state found");
}
startPeriodicSave();

// Start HTTP server
const port = parseInt(process.env.PORT ?? "3000", 10);
await app.listen({ port, host: "0.0.0.0" });

// Socket.io on top of Fastify's underlying HTTP server
const io = new Server(app.server, {
  cors: { origin: "*" },
});

let spectatorCount = 0;

io.on("connection", (socket) => {
  spectatorCount++;
  setSpectatorCount(spectatorCount);
  app.log.info(`Spectator connected (${spectatorCount} total)`);

  // Send current state immediately
  socket.emit("game:tick", getState());

  socket.on("disconnect", () => {
    spectatorCount--;
    setSpectatorCount(spectatorCount);
    app.log.info(`Spectator disconnected (${spectatorCount} total)`);
  });
});

// Wire game events to Socket.io
setOnTick((state) => {
  io.emit("game:tick", state);
});

setOnEvent((event, data) => {
  io.emit(event, data);
});

app.log.info(`Snake AI Game Server running on http://0.0.0.0:${port}`);
app.log.info(`Big screen: http://localhost:${port}`);
app.log.info(`API docs: http://localhost:${port}/docs`);
