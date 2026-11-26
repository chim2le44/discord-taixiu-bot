import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';

describe('Repository (SQLite transactions)', () => {
  let db: DatabaseSync;
  let repo: Repository;
  const G = 'guild-1';
  const C = 'chan-1';

  beforeEach(() => {
    db = openDatabase(':memory:');
    repo = new Repository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('prevents opposite TAI/XIU and CHAN/LE bets in the same round and prevents overdraft', () => {
    const roundId = repo.createRound(G, C);
    expect(repo.placeBet(G, roundId, 'u1', 'TAI', 4_000)).toEqual({
      ok: true,
      newBalance: 6_000,
    });
    expect(repo.placeBet(G, roundId, 'u1', 'XIU', 1_000).ok).toBe(false);

    // Chẵn + Số + Tổng alongside Tài is allowed
    expect(repo.placeBet(G, roundId, 'u1', 'CHAN', 1_000)).toEqual({
      ok: true,
      newBalance: 5_000,
    });
    expect(repo.placeBet(G, roundId, 'u1', 'LE', 500).ok).toBe(false);
    expect(repo.placeBet(G, roundId, 'u1', 'SO_5', 500)).toEqual({
      ok: true,
      newBalance: 4_500,
    });
    expect(repo.placeBet(G, roundId, 'u1', 'TONG_12', 500)).toEqual({
      ok: true,
      newBalance: 4_000,
    });

    expect(repo.getRoundTotals(roundId)).toEqual({
      taiTotal: 4_000,
      xiuTotal: 0,
      chanTotal: 1_000,
      leTotal: 0,
      extraTotal: 1_000,
      totalBetCount: 4,
    });

    // Overdraft rejected
    expect(repo.placeBet(G, roundId, 'u1', 'TAI', 6_000).ok).toBe(false);
  });

  it('repeats last settled bet and settles round accurately', () => {
    const r1 = repo.createRound(G, C);
    repo.placeBet(G, r1, 'u1', 'TAI', 1_000);
    repo.placeBet(G, r1, 'u1', 'LE', 200);
    repo.settleRoundInDb(G, r1, [5, 4, 4]); // 13 -> TAI + LE: 1900 + 380 = 2280; balance = 8800 + 2280 = 11080

    const r2 = repo.createRound(G, C);
    const repeated = repo.repeatLastBet(G, r2, 'u1');
    expect(repeated.ok).toBe(true);
    if (repeated.ok) {
      expect(repeated.totalAmount).toBe(1_200);
      expect(repeated.newBalance).toBe(9_880);
    }
  });

  it('refunds all OPEN rounds on crash recovery', () => {
    const r1 = repo.createRound(G, C);
    repo.placeBet(G, r1, 'u1', 'TAI', 3_000);
    repo.placeBet(G, r1, 'u2', 'XIU', 2_000);

    const recovery = repo.refundOpenRounds();
    expect(recovery).toEqual({
      refundedRounds: 1,
      refundedBets: 2,
      refundedAmount: 5_000,
    });

    expect(repo.ensureUser(G, 'u1').balance).toBe(10_000);
    expect(repo.ensureUser(G, 'u2').balance).toBe(10_000);

    expect(repo.refundOpenRounds().refundedRounds).toBe(0);
  });

  it('enforces daily cooldown and bailout rules (0 balance and no open bets)', () => {
    const now = 1_700_000_000_000;
    const daily1 = repo.claimDaily(G, 'u1', now);
    expect(daily1).toEqual({ ok: true, amount: 5_000, newBalance: 15_000 });
    expect(repo.claimDaily(G, 'u1', now + 60_000).ok).toBe(false);

    expect(repo.claimBailout(G, 'u1', now).ok).toBe(false);

    const r1 = repo.createRound(G, C);
    repo.placeBet(G, r1, 'u1', 'TAI', 15_000);
    expect(repo.ensureUser(G, 'u1').balance).toBe(0);
    expect(repo.claimBailout(G, 'u1', now).ok).toBe(false);

    repo.settleRoundInDb(G, r1, [1, 2, 3]);
    expect(repo.claimBailout(G, 'u1', now)).toEqual({
      ok: true,
      amount: 1_500,
      newBalance: 1_500,
    });
  });

  it('transfers coins with 5% tax added to guild jackpot and supports admin adjustments', () => {
    const transfer = repo.transferCoins(G, 'u1', 'u2', 1_000);
    expect(transfer).toEqual({
      ok: true,
      sent: 1_000,
      tax: 50,
      received: 950,
      senderBalance: 9_000,
    });
    expect(repo.ensureUser(G, 'u2').balance).toBe(10_950);
    expect(repo.getGuildSettings(G).jackpotPool).toBe(50);

    const adj = repo.adminAdjustCoins(G, 'u1', -20_000);
    expect(adj).toEqual({ previousBalance: 9_000, newBalance: 0 });
  });

  it('settles Golden rounds, persists lose streaks across rounds, and filters lose_streak leaderboard >= 3', () => {
    const goldenRound = repo.createRound(G, C, true);
    expect(repo.isRoundGolden(goldenRound)).toBe(true);
    repo.placeBet(G, goldenRound, 'u1', 'TAI', 1_000);
    const gRes = repo.settleRoundInDb(G, goldenRound, [5, 3, 3]); // TAI -> x2.1 = 2,100
    expect(gRes.settlement.isGolden).toBe(true);
    expect(repo.ensureUser(G, 'u1').balance).toBe(11_100);
    expect(repo.getGuildSettings(G).jackpotPool).toBe(100); // 10% of 1,000

    // Lose 5 rounds in a row for u2 (1,000 each -> 5,000 total loss -> 15% = 750 consolation on 5th)
    for (let i = 0; i < 5; i += 1) {
      const r = repo.createRound(G, C, false);
      repo.placeBet(G, r, 'u2', 'TAI', 1_000);
      repo.settleRoundInDb(G, r, [1, 2, 3]); // XIU
    }

    const u2 = repo.ensureUser(G, 'u2');
    expect(u2.currentLoseStreak).toBe(5);
    expect(u2.bestLoseStreak).toBe(5);
    expect(u2.loseStreakLoss).toBe(5_000);
    expect(u2.balance).toBe(5_750); // 10,000 - 5,000 + 750

    // u3 loses only 2 rounds -> excluded from lose_streak leaderboard (< 3)
    for (let i = 0; i < 2; i += 1) {
      const r = repo.createRound(G, C, false);
      repo.placeBet(G, r, 'u3', 'TAI', 500);
      repo.settleRoundInDb(G, r, [1, 2, 3]);
    }
    const unluckyBoard = repo.getLeaderboard(G, 'lose_streak', 10);
    expect(unluckyBoard.map((u) => u.userId)).toEqual(['u2']);
  });

  it('migrates legacy SQLite tables missing is_golden and lose_streak columns without losing data', () => {
    const legacy = new DatabaseSync(':memory:');
    legacy.exec(`
      CREATE TABLE users (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        balance INTEGER NOT NULL,
        total_games INTEGER NOT NULL DEFAULT 0,
        total_wins INTEGER NOT NULL DEFAULT 0,
        current_streak INTEGER NOT NULL DEFAULT 0,
        best_streak INTEGER NOT NULL DEFAULT 0,
        net_profit INTEGER NOT NULL DEFAULT 0,
        last_daily_at INTEGER NOT NULL DEFAULT 0,
        last_bailout_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      );
      CREATE TABLE rounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        status TEXT NOT NULL,
        d1 INTEGER,
        d2 INTEGER,
        d3 INTEGER,
        outcome TEXT,
        jackpot_payout INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        settled_at INTEGER
      );
      INSERT INTO users (guild_id, user_id, balance) VALUES ('g1', 'legacy-u', 77777);
    `);

    const tmpPath = path.join(os.tmpdir(), `taixiu-legacy-${Date.now()}.sqlite`);
    legacy.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
    legacy.close();

    const migrated = openDatabase(tmpPath);
    try {
      const migratedRepo = new Repository(migrated);
      const user = migratedRepo.ensureUser('g1', 'legacy-u');
      expect(user.balance).toBe(77_777);
      expect(user.currentLoseStreak).toBe(0);
      expect(user.bestLoseStreak).toBe(0);
      expect(user.claimedNewbie).toBe(false);
      const r = migratedRepo.createRound('g1', 'c1', true);
      expect(migratedRepo.isRoundGolden(r)).toBe(true);
    } finally {
      migrated.close();
      fs.rmSync(tmpPath, { force: true });
      fs.rmSync(`${tmpPath}-wal`, { force: true });
      fs.rmSync(`${tmpPath}-shm`, { force: true });
    }
  });

  it('grants newbie gift of 50,000,000 xu once per user and rejects repeat claims', () => {
    const first = repo.claimNewbieGift(G, 'u1');
    expect(first).toEqual({
      ok: true,
      amount: 50_000_000,
      newBalance: 50_010_000,
    });
    expect(repo.ensureUser(G, 'u1').claimedNewbie).toBe(true);

    const second = repo.claimNewbieGift(G, 'u1');
    expect(second.ok).toBe(false);
    expect(repo.ensureUser(G, 'u1').balance).toBe(50_010_000);
  });
});
