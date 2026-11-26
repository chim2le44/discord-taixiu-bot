# Discord Tài Xỉu Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight, race-condition-free Discord Tài Xỉu bot in TypeScript (`discord.js` v14 + built-in `node:sqlite`) with session tables, Jackpot/Bão mechanics, win-streaks, economy commands, and unit tests.

**Architecture:** Strict 3-layer separation (`src/engine/` pure game logic, `src/db/` synchronous SQLite transactions, `src/discord/` Discord interactions & embeds). Zero `discord.js` imports inside `src/engine/` or `src/db/`.

**Tech Stack:** Node.js >= 22.13 (`node:sqlite`, `node:crypto`), TypeScript 5.7 (`NodeNext`), `discord.js` v14, `dotenv`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-11-26-taixiu-bot-design.md`

## Global Constraints
- Relative imports in TypeScript MUST use `.js` extensions (`moduleResolution: "NodeNext"`).
- `src/engine/` and `src/db/` MUST NOT import `discord.js`.
- All balance-mutating DB operations MUST execute inside `withTransaction(db, ...)` using `BEGIN IMMEDIATE`.
- Slash commands only (`GatewayIntentBits.Guilds` only, no privileged message content intent).
- Minimum bet `100`, starting balance `10_000`, round betting `35_000 ms`, reveal `2_500 ms`, next round `5_000 ms`, max empty rounds `2`.

## Review Focus
- Rapid double-clicks / concurrent bets on buttons or modals exceeding balance or placing both `TAI` and `XIU` in one round.
- Bot restart while a round is `OPEN` (must refund all bets and mark `CANCELLED` without double-refunding).
- `BAO` outcome when nobody bet `BAO` (100% refund, streaks preserved) vs when multiple players bet `BAO` (proportional jackpot split with integer remainder kept in pool).
- `claimBailout` attempted when balance is `0` but user still has pending bets in an `OPEN` round.
- `parseBetAmount` edge cases (`0`, `-100`, `NaN`, `Infinity`, `101%`, `1.5k`, `all` when balance `< 100`).

---

### Task 1: Project Scaffolding & Config
**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `AGENTS.md`, `README.md`
- [ ] **Step 1:** Create configuration and documentation files with `"type": "module"` and strict TypeScript config.
- [ ] **Step 2:** Verify `npm run typecheck` once Node.js is installed.

### Task 2: Pure Engine (`src/engine/`)
**Files:**
- Create: `src/engine/types.ts`, `src/engine/dice.ts`, `src/engine/betParser.ts`, `src/engine/settlement.ts`, `src/engine/tableManager.ts`
- Test: `tests/betParser.test.ts`, `tests/settlement.test.ts`, `tests/tableManager.test.ts`
- **Interfaces:**
  - `rollDice(): DiceRoll`, `classifyRoll(dice: DiceRoll)`
  - `parseBetAmount(raw: string, balance: number, minBet?: number)`
  - `settleRound(input: SettlementInput): RoundSettlementResult`
  - `TableManager(callbacks: TableCallbacks, timings?: TableTimings)`
- [ ] **Step 1:** Write unit tests in `tests/betParser.test.ts`, `tests/settlement.test.ts`, `tests/tableManager.test.ts`.
- [ ] **Step 2:** Implement engine modules and verify tests pass with `npm test`.

### Task 3: SQLite Persistence (`src/db/`)
**Files:**
- Create: `src/db/database.ts`, `src/db/repository.ts`
- Test: `tests/repository.test.ts`
- **Interfaces:**
  - `openDatabase(dbPath: string): DatabaseSync`
  - `withTransaction<T>(db: DatabaseSync, fn: () => T): T`
  - `Repository(db: DatabaseSync)`
- [ ] **Step 1:** Write `tests/repository.test.ts` covering atomic bets, `TAI`+`XIU` block, `repeatLastBet`, `settleRoundInDb`, `refundOpenRounds`, `claimDaily`, `claimBailout`, `transferCoins`, `adminAdjustCoins`, `getLeaderboard`.
- [ ] **Step 2:** Implement `database.ts` and `repository.ts` and verify tests pass.

### Task 4: Discord Adapter & Entrypoints (`src/discord/`, `src/index.ts`, `src/registerCommands.ts`)
**Files:**
- Create: `src/discord/embeds.ts`, `src/discord/commands.ts`, `src/discord/interactions.ts`, `src/index.ts`, `src/registerCommands.ts`
- [ ] **Step 1:** Implement embeds, 8 slash command handlers, button/modal interaction handlers with 1.5s embed edit throttling, and graceful shutdown.
- [ ] **Step 2:** Run `npm run typecheck && npm test` and verify zero errors.
