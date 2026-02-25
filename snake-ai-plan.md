# Multiplayer Snake AI — Claude Code Build Plan

## Concept

A multiplayer snake game where participants don't control their snake manually — they submit a JavaScript AI function that controls it. Every game tick, the server calls all submitted AI functions locally with the current game state and each function returns a direction. No network calls during gameplay — smooth, fast, deterministic.

When a snake dies its body turns into food. Other snakes can eat it to grow. A big snake death is a dramatic food windfall. The goal is to be the last snake alive, or have the highest score when time runs out.

Participants watch their snake die, tell Claude Code why it died, iterate on the AI, and resubmit. The new snake spawns in immediately. This is the core loop.

---

## How It Works End to End

**The Game Server (host's laptop)**
- Runs the game loop at a fixed tick rate (e.g. 10 ticks/second)
- Each tick: calls every snake's AI function with the current game state
- Collects directions, advances all snakes simultaneously, resolves collisions
- Broadcasts the new game state to the big screen via Socket.io
- Accepts new AI submissions at any time — snake is killed and respawned with new AI immediately

**Each Participant**
- Registers their name and submits a JavaScript AI function
- Watches their snake on the big screen
- When it dies: tells Claude Code what happened, iterates, resubmits
- Submitted function runs entirely on the server — no local server needed

**The Big Screen**
- Full-screen animated game board
- All snakes rendered with distinct colors and name labels
- Food tiles visible
- Leaderboard sidebar: alive/dead status, length, kills, food eaten
- Spectator count shown

---

## Tech Stack

- **Runtime:** Bun with TypeScript (native TS support, fast startup, built-in test runner)
- **HTTP Server:** Fastify with `@fastify/swagger` and `@fastify/swagger-ui`
- **Real-time:** Socket.io for game state broadcast to big screen
- **Game loop:** `setInterval` at configurable tick rate
- **Validation:** Zod with `fastify-type-provider-zod`
- **AI sandbox:** Worker threads with real timeout enforcement
- **Big screen UI:** Single `public/index.html`, HTML Canvas + vanilla JS

---

## Project Structure

```
snake-game-server/
├── src/
│   ├── server.ts          # Fastify setup, plugin registration
│   ├── routes.ts          # HTTP routes
│   ├── game.ts            # Game state, tick logic, collision detection
│   ├── board.ts           # Board representation, food spawning
│   ├── runner.ts          # AI function sandboxing via worker threads
│   ├── ai-worker.ts       # Worker thread entry point for AI execution
│   ├── schemas.ts         # Zod schemas
│   ├── types.ts           # TypeScript type definitions
│   └── config.ts          # Game constants (mutable singleton)
├── public/
│   └── index.html         # Big screen game visualization
├── package.json
├── tsconfig.json
└── README.md
```

---

## Data Structures

Define Zod schemas in `schemas.ts`, derive types in `types.ts`:

```typescript
type Direction = "UP" | "DOWN" | "LEFT" | "RIGHT"

interface Position {
  x: number   // 0 = left
  y: number   // 0 = top
}

interface Snake {
  id: string
  participantName: string
  color: string              // assigned on registration, e.g. "#e74c3c"
  segments: Position[]       // segments[0] is the head
  direction: Direction       // current direction of travel
  alive: boolean
  length: number             // same as segments.length
  score: number              // current life score
  totalScore: number         // all-time score across all lives
  kills: number
  totalKills: number         // all-time kills
  aiFunction: string         // the raw submitted JS function string
  diedAt?: number            // tick number when it died
  deathReason?: string       // "wall" | "self" | "snake:{name}"
}

interface FoodTile {
  position: Position
  value: number              // 1 for normal food, higher for snake corpse segments
}

interface GameState {
  tick: number
  status: "waiting" | "running" | "paused" | "finished"
  boardWidth: number
  boardHeight: number
  snakes: Snake[]
  food: FoodTile[]
  winnerId?: string
  spectatorCount: number
}

// What the AI function receives — a read-only view of the game
interface AIInput {
  you: {
    id: string
    head: Position
    segments: Position[]
    direction: Direction
    length: number
    score: number
  }
  board: {
    width: number
    height: number
  }
  snakes: Array<{            // all snakes including yourself
    id: string
    name: string
    head: Position
    segments: Position[]
    direction: Direction
    length: number
    alive: boolean
  }>
  food: Array<{
    position: Position
    value: number
  }>
  tick: number
}
```

---

## AI Function Contract (critical — document clearly in /docs)

The participant submits a JavaScript function with this signature:

```javascript
function move(state) {
  // state.you          — your snake (head, segments, direction, length, score)
  // state.board        — { width, height }
  // state.snakes       — all snakes including yourself (name, head, segments, alive)
  // state.food         — array of { position: {x, y}, value }
  // state.tick         — current tick number
  //
  // Return one of: "UP" | "DOWN" | "LEFT" | "RIGHT"
  // Returning an invalid value or throwing an error = snake continues straight

  return "UP"  // your logic here
}
```

**Execution rules:**
- Function must return synchronously
- Max execution time: 50ms per tick (exceeded = snake goes straight, no penalty)
- Returning an illegal 180° reversal (going UP when currently going DOWN) is ignored — snake continues in current direction
- Runtime errors are caught silently — snake goes straight that tick
- AI receives a deep copy of state — mutations have no effect

**Example starter AI (include this in the docs):**
```javascript
function move(state) {
  const { head, direction } = state.you
  const { width, height } = state.board

  // All occupied positions (walls are out of bounds)
  const occupied = new Set(
    state.snakes
      .filter(s => s.alive)
      .flatMap(s => s.segments)
      .map(p => `${p.x},${p.y}`)
  )

  // Try to continue in current direction, else turn
  const options = ["UP", "DOWN", "LEFT", "RIGHT"]
  const opposites = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" }

  const next = (pos, dir) => ({
    UP:    { x: pos.x,     y: pos.y - 1 },
    DOWN:  { x: pos.x,     y: pos.y + 1 },
    LEFT:  { x: pos.x - 1, y: pos.y     },
    RIGHT: { x: pos.x + 1, y: pos.y     },
  })[dir]

  const safe = (pos) =>
    pos.x >= 0 && pos.x < width &&
    pos.y >= 0 && pos.y < height &&
    !occupied.has(`${pos.x},${pos.y}`)

  for (const dir of [direction, ...options]) {
    if (dir === opposites[direction]) continue   // can't reverse
    if (safe(next(head, dir))) return dir
  }

  return direction  // nowhere safe, go straight and hope
}
```

---

## Game Rules

**Board:** 40×30 grid (configurable in `config.ts`)

**Startup:**
- Food is pre-spawned: one food tile per registered participant, minimum 5
- Snakes spawn at random positions along the edges facing inward
- Snakes start with length 3

**Each tick:**
1. Call all alive snakes' AI functions with current state (via worker threads)
2. Collect directions (apply reversal guard and error guard)
3. Move all snakes simultaneously:
   - Add new head in chosen direction
   - If new head is on food: keep tail (snake grows), remove food tile, spawn new food elsewhere
   - If new head is not on food: remove tail segment (snake moves)
4. Resolve collisions (after all moves):
   - Head hits wall → snake dies
   - Head hits any snake's body segment (including own) → snake dies
   - Head-to-head collision → both snakes die (always, regardless of length — simple and dramatic)
5. Convert dead snakes' segments into food tiles (value = 1 each, capped at maxFood)
6. Check win condition: one snake remaining, or all dead (highest score wins)
7. Broadcast new state via Socket.io

**Food mechanics:**
- Normal food: value 1 (grow by 1 segment)
- Corpse food (from dead snakes): value 1 per segment, clusters together — a big snake death creates a feast
- Always maintain minimum food on board: if food drops below (aliveSnakes / 2), spawn new food
- Max food cap: 50 tiles. Corpse food only spawned up to the cap to prevent board flooding

**Scoring:**
- Eating 1 food = +10 points
- Killing another snake = +100 points (awarded if your head caused their death)
- Surviving each tick = +1 point (rewards longevity)
- Final bonus: last snake alive = +500 points

---

## AI Runner (`runner.ts` + `ai-worker.ts`)

Uses worker threads with real timeout enforcement. An infinite loop in participant code will NOT hang the server.

```typescript
// runner.ts — spawns a worker thread per AI call with a real timeout
async function runAI(aiFunction: string, input: AIInput, timeoutMs: number): Promise<Direction | null> {
  return new Promise((resolve) => {
    const worker = new Worker('./src/ai-worker.ts')
    const timer = setTimeout(() => {
      worker.terminate()
      resolve(null) // too slow
    }, timeoutMs)

    worker.onmessage = (event) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(event.data.direction ?? null)
    }

    worker.onerror = () => {
      clearTimeout(timer)
      worker.terminate()
      resolve(null)
    }

    worker.postMessage({ aiFunction, input })
  })
}

// ai-worker.ts — runs inside worker thread
self.onmessage = (event) => {
  const { aiFunction, input } = event.data
  try {
    const safeInput = JSON.parse(JSON.stringify(input))
    const fn = new Function('state', aiFunction + '\nreturn move(state)')
    const result = fn(safeInput)

    const validDirections = ["UP", "DOWN", "LEFT", "RIGHT"]
    if (validDirections.includes(result)) {
      self.postMessage({ direction: result })
    } else {
      self.postMessage({ direction: null })
    }
  } catch {
    self.postMessage({ direction: null })
  }
}
```

For extra safety, strip `fetch`, `require`, `import`, `process`, `fs` from the function string before execution.

---

## HTTP API Routes

### `POST /api/register`
Register a participant and submit their initial AI function.

Request:
```json
{
  "name": "Rune",
  "aiFunction": "function move(state) { return 'RIGHT'; }"
}
```

Response:
```json
{
  "snakeId": "abc123",
  "color": "#e74c3c",
  "message": "Registered! Your snake will spawn when the game starts."
}
```

### `POST /api/submit`
Update AI function for an existing participant. Snake is killed and respawned immediately with the new AI.

Request:
```json
{
  "snakeId": "abc123",
  "aiFunction": "function move(state) { ... }"
}
```

Response:
```json
{
  "status": "updated",
  "message": "Snake respawned with new AI."
}
```

### `GET /api/state`
Current full game state (for debugging).

### `POST /api/admin/start`
Start the game loop.

### `POST /api/admin/pause`
Pause the game loop.

### `POST /api/admin/reset`
Reset board, respawn all snakes, clear scores.

### `DELETE /api/admin/snake/:id`
Remove a snake from the game (kick). Useful if a broken AI is causing issues.

### `POST /api/admin/config`
Update game speed or board size between games.

Request:
```json
{
  "tickRateMs": 100,
  "boardWidth": 40,
  "boardHeight": 30,
  "respawnOnDeath": true
}
```

### `GET /docs` / `GET /docs/json`
Swagger UI and OpenAPI spec.

---

## Respawn Mechanic

Two modes — host picks before the session:

**Tournament mode (`respawnOnDeath: false`)**
- Once your snake dies it stays dead
- Last snake alive wins the round
- Play multiple rounds, track cumulative score
- More dramatic, better for finals

**Continuous mode (`respawnOnDeath: true`)**
- Dead snake respawns after a short delay (e.g. 3 seconds) with length 3
- Great for workshop — participants iterate constantly without waiting
- Current-life score resets on death, but all-time totalScore accumulates across lives
- Leaderboard shows totalScore — rewards consistent performance
- Recommended for the learning phase

---

## Big Screen (`public/index.html`)

Single self-contained HTML file. Canvas for the game, sidebar for the leaderboard.

**Layout:**
- Left 75%: HTML Canvas rendering the game board
- Right 25%: Live leaderboard

**Canvas rendering (every Socket.io `game:tick` event):**
- Clear and redraw full board each tick (fast enough for 40×30 grid, simpler than diffing)
- Board background: dark grid
- Food tiles: small yellow/white dots, corpse food slightly different color
- Each snake: solid color with slightly lighter head cell
- Name label floating above the head
- Dead snakes: briefly show X animation, then segments animate turning into food

**Leaderboard sidebar:**
- Sorted by totalScore descending
- Each row: colored square + name + totalScore + current length + kills + alive/dead indicator
- Dead snakes shown greyed out with skull icon and death reason
- Animate score changes

**Spectator count:** Show number of connected big screen viewers

**Socket.io events to handle:**
| Event | Payload | Action |
|-------|---------|--------|
| `game:tick` | Full `GameState` | Re-render canvas and leaderboard |
| `game:started` | — | Show "GO!" overlay |
| `game:paused` | — | Show pause overlay |
| `game:finished` | Winner name | Show winner overlay |
| `snake:registered` | Participant name + color | Flash "new snake joining!" |
| `snake:died` | Name + death reason | Flash death notification |
| `snake:respawned` | Name | Flash respawn notification |

---

## Game Config (`config.ts`)

Mutable singleton — can be updated at runtime via `/api/admin/config`.

```typescript
export const config = {
  boardWidth: 40,
  boardHeight: 30,
  tickRateMs: 150,          // 150ms = ~6.5 ticks/second. Slow to start, speed up as people get better
  minFood: 5,
  maxFood: 50,              // cap to prevent board flooding from mass snake deaths
  respawnOnDeath: true,
  respawnDelayMs: 3000,
  aiTimeoutMs: 50,
  startingLength: 3,
  colors: [                 // assigned in order to participants
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
    "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
    "#00bcd4", "#8bc34a", "#ff5722", "#607d8b",
  ]
}
```

---

## README for the Host

```markdown
## Start the server

bun install
bun run dev

Open http://localhost:3000 on the big screen.
Find your local IP: ipconfig getifaddr en0 (macOS)

## Running a session

# Start the game
curl -X POST http://localhost:3000/api/admin/start

# Pause for discussion
curl -X POST http://localhost:3000/api/admin/pause

# Reset and play again (keeps registrations)
curl -X POST http://localhost:3000/api/admin/reset

# Kick a problematic snake
curl -X DELETE http://localhost:3000/api/admin/snake/abc123

# Slow down for beginners / speed up for finals
curl -X POST http://localhost:3000/api/admin/config \
  -H "Content-Type: application/json" \
  -d '{"tickRateMs": 200}'

## Recommended session flow

1. Start slow (tickRateMs: 200) while people get their first submission working
2. Speed up to 150 once everyone has a moving snake
3. Switch to tournament mode (respawnOnDeath: false) for the final round
```

---

## What Participants Tell Claude Code

Initial registration:

> "I am entering a multiplayer snake AI competition. The server is at http://[HOST_IP]:3000. Read the API documentation at /docs/json to understand the game rules and the AI function contract. Register me as '[MY NAME]' with a simple starting AI that just avoids walls and keeps moving. Get my snake registered and into the game."

After first death (wall collision):

> "My snake keeps hitting walls. Look at the AI function contract again and fix the wall avoidance logic."

After second death (other snake collision):

> "My snake is avoiding walls but it's running into other snakes. Update the AI to treat other snakes' body segments as obstacles too."

Later iterations:

> "My snake survives but it's not going for food. Add food-seeking behavior — move toward the nearest food when safe."

> "My snake ignores other snakes completely. Add basic trap avoidance — if a direction leads to a dead end, prefer a direction with more open space."

> "Add flood fill to count reachable cells in each direction and always move toward the direction with the most open space."

This progression is the Claude Code teaching arc of the whole workshop.

---

## Strategic Depth for Advanced Participants

The basic "avoid walls and snakes" AI is easy for Claude Code to write in round 1. The interesting challenge is pushing past that. Here are the layers of strategy Claude Code can be guided toward, in increasing complexity:

**Level 1 — Survival:** Don't hit walls, don't hit snakes. (5 minutes)

**Level 2 — Food seeking:** BFS to nearest food. (10 minutes)

**Level 3 — Space awareness:** Flood fill — count reachable cells per direction. Prefer directions with more space. Avoids boxing yourself in. (15 minutes)

**Level 4 — Aggression:** If your snake is longer than another snake and you're close, pursue their head. Cut them off. (20 minutes)

**Level 5 — Corpse chasing:** When a big snake dies, navigate to the food cluster. (20 minutes)

**Level 6 — Trapping:** Project where an enemy snake will be in 3-5 ticks, move to cut off their escape routes. This is hard and impressive. (30+ minutes)

Each level is a natural conversation to have with Claude Code. The participant explains the strategy in plain language; Claude Code translates it to code. That's the skill the workshop is teaching.

---

## Build Order for Claude Code

1. `package.json`, `tsconfig.json`, `config.ts`
2. `types.ts` + `schemas.ts` — types and Zod schemas
3. `board.ts` — grid representation, food spawning, position utilities
4. `ai-worker.ts` + `runner.ts` — AI function sandboxing with worker threads
5. `game.ts` — game state, tick logic, collision detection, scoring
6. `routes.ts` — all HTTP routes including admin kick endpoint
7. `server.ts` — wire everything together, Socket.io setup
8. `public/index.html` — canvas rendering and leaderboard
9. `README.md`

**Test each step:**
- After `game.ts`: write a small test that runs 10 ticks with 2 hardcoded AI functions and prints the state
- After `routes.ts`: manually register a snake via curl and verify it appears in `/api/state`
- After `index.html`: open the big screen and verify the canvas renders before hooking up real AI

---

## Success Criteria

- Registering a snake via `POST /api/register` makes it appear on the big screen immediately
- `POST /api/submit` with a new AI function kills and respawns the snake with new AI within 1 tick
- A snake with `return "RIGHT"` as its entire AI moves right and dies when it hits the wall
- Head-to-head collision kills both snakes and their bodies become food
- Dead snake segments appear as food tiles on the canvas
- The leaderboard updates in real time with correct totalScore
- A new participant can register and have a moving snake on the big screen in under 3 minutes with Claude Code
- The game runs smoothly at 10 ticks/second with 10 simultaneous snakes
- An infinite loop in AI code does not hang the server (worker thread timeout works)
- Kicking a snake via `DELETE /api/admin/snake/:id` removes it immediately
