# Design: Prefix `.` Commands + Phiên Giờ Vàng + Thánh Đen

## Intent
Make the Discord Tài Xỉu bot faster and more fun in active channels:
- **Player `.` prefix commands** (keeping `/` Slash Commands exclusively for Admins) so players can type `.tx`, `.vi`, `.daily`, `.cau`, etc. directly in chat.
- **Phiên Giờ Vàng (Golden Round)** to create occasional high-excitement rounds.
- **Thánh Đen (Lose Streak)** to turn bad luck into social banter plus fair consolation.

## Approaches & Decisions
- **Persistence:** Add columns to SQLite (`users` and `rounds`) via idempotent `ALTER TABLE ... ADD COLUMN` checks on startup instead of RAM-only tracking, so lose-streak records and Golden Round state survive restarts without wiping existing balances or history.
- **Anti-abuse:**
  - Golden Round boosts only `TAI`/`XIU`/`CHAN`/`LE` (`x1.9 -> x2.1`) and jackpot contribution (`5% -> 10%`); `SO_*` and `TONG_*` stay unchanged so players cannot hedge across sums for guaranteed profit.
  - Thánh Đen consolation refunds a percentage of *cumulative net loss* during the streak (15% at 5 losses capped at 15,000 xu; 25% at 8 losses capped at 30,000 xu) rather than flat payouts, preventing small-bet farming.
- **Command split:** Only `/admin-kenh` and `/admin-xu` remain registered as Slash Commands. Player commands move to `.`-prefixed messages (`MessageCreate` with `GuildMessages` + `MessageContent` intents), silently ignoring unrecognized `.`-messages like `...`.

## Scope & Components
- `src/engine/`: `GAME_CONFIG` constants, `rollIsGolden()`, Golden Round multiplier & jackpot rate, lose-streak tracking & consolation calculation in `settleRound()`.
- `src/db/`: `ensureColumn()` migration for `is_golden`, `current_lose_streak`, `best_lose_streak`, `lose_streak_loss`; `Repository` round/settlement/leaderboard updates.
- `src/discord/` & `src/index.ts`: Golden Round & Thánh Đen embed rendering (keeping losers in `💀 THUA` even when consolation exceeds current bet), `.nv` button owner guard, `.` command parser/handlers, `MessageCreate` wiring.
