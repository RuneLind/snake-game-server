# Snake AI Arena

A multiplayer snake game where participants submit JavaScript AI functions to control their snakes. Built for workshops teaching AI-assisted coding with Claude Code.

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
  -d '{"name": "YourName", "aiFunction": "function move(state) { return \"RIGHT\"; }"}'
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
# Start the game
curl -X POST http://localhost:3000/api/admin/start

# Pause
curl -X POST http://localhost:3000/api/admin/pause

# Reset (keeps registrations)
curl -X POST http://localhost:3000/api/admin/reset

# Kick a snake
curl -X DELETE http://localhost:3000/api/admin/snake/SNAKE_ID

# Change speed
curl -X POST http://localhost:3000/api/admin/config \
  -H "Content-Type: application/json" \
  -d '{"tickRateMs": 200}'
```

## Session Flow

1. Start slow (`tickRateMs: 200`) while people get their first submission working
2. Speed up to 150 once everyone has a moving snake
3. Switch to tournament mode (`respawnOnDeath: false`) for the final round

## AI Function Contract

```javascript
function move(state) {
  // state.you       — { id, head, segments, direction, length, score }
  // state.board     — { width, height }
  // state.snakes    — [{ id, name, head, segments, direction, length, alive }]
  // state.food      — [{ position: {x, y}, value }]
  // state.tick      — current tick number
  //
  // Return: "UP" | "DOWN" | "LEFT" | "RIGHT"
  // Invalid return or error = snake continues straight

  return "RIGHT";
}
```

### Rules
- 50ms execution limit (exceeded = go straight)
- 180° reversals ignored
- Errors caught silently — snake goes straight
- State is a deep copy — mutations have no effect
