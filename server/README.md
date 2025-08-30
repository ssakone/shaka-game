Multiplayer WebSocket Server

Overview
- Minimal Node.js WebSocket server (no external dependencies).
- Supports quick 1v1 matchmaking, room creation/join by code, ready states, host-controlled start, basic game progress, and reconnect.

Run
- Prerequisite: Node.js 16+.
- From `server/`:
  - Install (no deps required): `npm install` (optional)
  - Start: `npm start`
- Default port: `3002` (override via env: `PORT=4000 npm start`).
- Health check: `http://localhost:3002/health`.

Protocol (JSON over WebSocket)
- Client must start with: `{ type: "hello", sessionId?: string, nick?: string }`.
- Server replies: `{ type: "hello", sessionId }`.
- Matchmaking: `{ type: "queue:join" }` / `{ type: "queue:leave" }`.
- Create room: `{ type: "room:create" }` -> `{ type: "room:created", roomId, code, hostId, members }`.
- Join room: `{ type: "room:join", code }` -> `{ type: "room:joined", roomId, code, hostId, members }`.
- Ready toggle: `{ type: "room:ready", ready: boolean }` -> broadcast `{ type: "room:state", members }`.
- Start (host): `{ type: "room:start" }` -> broadcast `{ type: "game:start", seed, startAt }`.
- Progress: `{ type: "game:progress", found }` -> broadcast to others.

Notes
- Reconnect: Send the same `sessionId` in `hello` to resume state. If in a room, you receive the latest room state and `game:start` if already launched.
- Only text frames are handled; fragmentation is not supported. Suitable for this game’s use case.
