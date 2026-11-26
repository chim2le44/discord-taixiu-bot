import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Opens a SQLite database using Node's built-in `node:sqlite`, enables WAL mode,
 * and ensures all required tables and indexes exist.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (dir && dir !== '.') {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      balance INTEGER NOT NULL,
      total_games INTEGER NOT NULL DEFAULT 0,
      total_wins INTEGER NOT NULL DEFAULT 0,
      current_streak INTEGER NOT NULL DEFAULT 0,
      best_streak INTEGER NOT NULL DEFAULT 0,
      current_lose_streak INTEGER NOT NULL DEFAULT 0,
      best_lose_streak INTEGER NOT NULL DEFAULT 0,
      lose_streak_loss INTEGER NOT NULL DEFAULT 0,
      net_profit INTEGER NOT NULL DEFAULT 0,
      last_daily_at INTEGER NOT NULL DEFAULT 0,
      last_bailout_at INTEGER NOT NULL DEFAULT 0,
      claimed_newbie INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      allowed_channel_id TEXT,
      jackpot_pool INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL,
      d1 INTEGER,
      d2 INTEGER,
      d3 INTEGER,
      outcome TEXT,
      is_golden INTEGER NOT NULL DEFAULT 0,
      jackpot_payout INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL,
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      side TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payout INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (round_id) REFERENCES rounds(id)
    );

    CREATE TABLE IF NOT EXISTS daily_quests (
      guild_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      date_key TEXT NOT NULL,
      games_played INTEGER NOT NULL DEFAULT 0,
      games_won INTEGER NOT NULL DEFAULT 0,
      total_wagered INTEGER NOT NULL DEFAULT 0,
      claimed_play INTEGER NOT NULL DEFAULT 0,
      claimed_win INTEGER NOT NULL DEFAULT 0,
      claimed_wager INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, date_key)
    );

    CREATE TABLE IF NOT EXISTS lixi_packets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      message_id TEXT,
      creator_id TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      remaining_amount INTEGER NOT NULL,
      total_slots INTEGER NOT NULL,
      remaining_slots INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lixi_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packet_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      claimed_at INTEGER NOT NULL,
      UNIQUE (packet_id, user_id),
      FOREIGN KEY (packet_id) REFERENCES lixi_packets(id)
    );

    CREATE INDEX IF NOT EXISTS idx_bets_round ON bets(round_id);
    CREATE INDEX IF NOT EXISTS idx_bets_user_round ON bets(guild_id, user_id, round_id);
    CREATE INDEX IF NOT EXISTS idx_rounds_guild_status ON rounds(guild_id, status);
    CREATE INDEX IF NOT EXISTS idx_lixi_status_expires ON lixi_packets(status, expires_at);
  `);

  ensureColumn(db, 'users', 'current_lose_streak', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'best_lose_streak', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'lose_streak_loss', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'users', 'claimed_newbie', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'rounds', 'is_golden', 'INTEGER NOT NULL DEFAULT 0');

  return db;
}

/**
 * Executes `fn` inside an immediate synchronous SQLite transaction so concurrent
 * Discord button clicks cannot interleave reads and writes.
 */
export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
