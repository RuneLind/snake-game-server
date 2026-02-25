# Snake AI Arena

A Slither.io-style multiplayer snake game where participants submit JavaScript AI functions to control their snakes. Built for workshops teaching AI-assisted coding with Claude Code.

Snakes move continuously in a circular arena. AI functions return a target angle each tick. No grid, no tiles — smooth movement in any direction.

## Quick Start

```bash
bun install
bun run dev
```

Open http://localhost:3000 on the big screen.

Find your local IP: `ipconfig getifaddr en0` (macOS)

## API

### Participant Endpoints

**Register:**
```bash
curl -X POST http://HOST:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "YourName", "aiFunction": "function move(state) { return 0; }"}'
```

**Update AI (kills and respawns your snake):**
```bash
curl -X POST http://HOST:3000/api/submit \
  -H "Content-Type: application/json" \
  -d '{"snakeId": "YOUR_ID", "aiFunction": "function move(state) { ... }"}'
```

**Debug state:** `GET http://HOST:3000/api/state`

**AI contract docs:** `GET http://HOST:3000/api/docs/ai-contract`

**Swagger UI:** http://HOST:3000/docs

### Admin Endpoints

```bash
curl -X POST http://localhost:3000/api/admin/start
curl -X POST http://localhost:3000/api/admin/pause
curl -X POST http://localhost:3000/api/admin/reset
curl -X DELETE http://localhost:3000/api/admin/snake/SNAKE_ID
curl -X POST http://localhost:3000/api/admin/config \
  -H "Content-Type: application/json" \
  -d '{"tickRateMs": 80}'
```

## AI Function Contract

```javascript
function move(state) {
  // state.you    — { id, x, y, angle, speed, segments, length, score }
  // state.arena  — { radius } (circular arena centered at 0,0)
  // state.snakes — [{ id, name, x, y, angle, segments, length, alive }]
  // state.food   — [{ x, y, value }]
  // state.tick   — current tick number
  //
  // Return: a number (target angle in radians)
  //   0 = right, PI/2 = down, PI = left, 3*PI/2 = up
  //
  // Helper functions available:
  //   angleTo(x1, y1, x2, y2) — angle from point 1 to point 2
  //   distTo(x1, y1, x2, y2) — distance between two points
  //   distFromCenter(x, y)   — distance from arena center

  return 0; // go right
}
```

### Rules
- 50ms execution limit (exceeded = go straight)
- Snake turns toward target angle at ~4.6 degrees per tick
- No self-collision (only die from other snakes or boundary)
- Errors caught silently — snake goes straight
- State is a deep copy — mutations have no effect

### Starter AI

```javascript
function move(state) {
  const { x, y, angle } = state.you;

  // Stay away from boundary
  if (distFromCenter(x, y) > state.arena.radius * 0.8) {
    return angleTo(x, y, 0, 0);
  }

  // Find nearest food
  let nearest = null;
  let nearestDist = Infinity;
  for (const f of state.food) {
    const d = distTo(x, y, f.x, f.y);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = f;
    }
  }

  if (nearest) return angleTo(x, y, nearest.x, nearest.y);
  return angle;
}
```

## Session Flow

1. Start with default speed while people get their first submission working
2. Increase `snakeSpeed` or decrease `tickRateMs` once everyone has a moving snake
3. Switch to tournament mode (`respawnOnDeath: false`) for the final round
