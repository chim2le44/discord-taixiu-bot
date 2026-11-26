# AGENTS.md

## Stack & Runtime
- Node.js `>=22.13.0` (uses built-in `node:sqlite` and `node:crypto`)
- TypeScript 5 (`"type": "module"`, `"moduleResolution": "NodeNext"` — **always include `.js` extensions on relative imports**)
- `discord.js` v14 (Prefix `.` commands for players via `GuildMessages` + `MessageContent`, Slash Commands `/` for admins only, plus Buttons + Modals)
- `@napi-rs/canvas` + `gifenc` for PNG charts/dice and animated bowl-shake GIF
- `vitest` for unit tests

## Architecture Rules (4 Modules)
1. `src/engine/`: Pure game rules, dice RNG, bet parser, settlement math, lixi/quests helpers, table lifecycle. **NEVER import `discord.js`, `@napi-rs/canvas`, or `node:sqlite` here.**
2. `src/graphics/`: Pure image/GIF rendering (`@napi-rs/canvas`, `gifenc`). **NEVER import `discord.js` or `node:sqlite` here.**
3. `src/db/`: SQLite schema & synchronous `Repository`. **NEVER import `discord.js` here.** Every balance mutation MUST run inside `withTransaction(db, ...)` (`BEGIN IMMEDIATE`).
4. `src/discord/`: Discord commands, button/modal handlers, and embed builders.

## Verification
Run after every change:
```bash
npm run typecheck && npm test
```
