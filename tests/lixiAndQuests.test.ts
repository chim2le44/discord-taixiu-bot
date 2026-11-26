import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import { drawLixiAmount } from '../src/engine/lixi.js';
import { getVnDateKey } from '../src/engine/quests.js';

describe('Lixi, Daily Quests, and Solo 1v1', () => {
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

  it('drawLixiAmount preserves total sum across all slots', () => {
    let remaining = 1_000;
    const slots = 7;
    let totalDrawn = 0;

    for (let s = slots; s >= 1; s -= 1) {
      const amt = drawLixiAmount(remaining, s);
      expect(amt).toBeGreaterThanOrEqual(1);
      expect(remaining - amt).toBeGreaterThanOrEqual(s - 1);
      remaining -= amt;
      totalDrawn += amt;
    }

    expect(remaining).toBe(0);
    expect(totalDrawn).toBe(1_000);
  });

  it('creates, claims, prevents duplicate claims, and refunds expired lixi packets', () => {
    const now = 1_700_000_000_000;
    const created = repo.createLixiPacket(G, C, 'creator', 1_000, 2, now);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.creatorBalance).toBe(9_000);
    expect(repo.getOpenLixiPackets().map((p) => p.id)).toEqual([created.packet.id]);

    const claim1 = repo.claimLixiPacket(created.packet.id, 'u1', now + 1_000);
    expect(claim1.ok).toBe(true);
    if (!claim1.ok) return;

    // Duplicate claim by same user fails
    expect(repo.claimLixiPacket(created.packet.id, 'u1', now + 2_000).ok).toBe(false);

    // Expire packet before 2nd slot is claimed -> remainder refunded to creator
    const expired = repo.expireLixiPackets(now + 6 * 60 * 1000);
    expect(expired.expiredCount).toBe(1);
    expect(expired.refundedAmount).toBe(1_000 - claim1.amount);
    expect(repo.ensureUser(G, 'creator').balance).toBe(9_000 + (1_000 - claim1.amount));
  });

  it('tracks daily quest progress across settled rounds and pays claimable rewards once', () => {
    const now = Date.UTC(2026, 10, 26, 7, 0, 0);
    expect(getVnDateKey(now)).toBe('2026-11-26');

    for (let i = 0; i < 5; i += 1) {
      const r = repo.createRound(G, C);
      repo.placeBet(G, r, 'u1', 'TAI', 2_000);
      // 3 wins, 2 losses; total wagered = 10,000
      const dice = i < 3 ? ([5, 4, 4] as const) : ([1, 2, 3] as const);
      repo.settleRoundInDb(G, r, dice, now);
    }

    const q = repo.getDailyQuests(G, 'u1', now);
    expect(q.gamesPlayed).toBe(5);
    expect(q.gamesWon).toBe(3);
    expect(q.totalWagered).toBe(10_000);

    const claim = repo.claimDailyQuestRewards(G, 'u1', now);
    expect(claim.totalReward).toBe(2_000 + 3_000 + 4_000);
    expect(claim.claimedRewards).toHaveLength(3);

    // Claiming again yields 0
    const secondClaim = repo.claimDailyQuestRewards(G, 'u1', now);
    expect(secondClaim.totalReward).toBe(0);
  });

  it('settles 1v1 solo matches atomically for win and tie', () => {
    const winRes = repo.settleSoloMatch(G, 'u1', 'u2', 2_500, [6, 5, 4], [1, 2, 3]);
    expect(winRes).toEqual({
      ok: true,
      winnerId: 'u1',
      challengerSum: 15,
      opponentSum: 6,
    });
    expect(repo.ensureUser(G, 'u1').balance).toBe(12_500);
    expect(repo.ensureUser(G, 'u2').balance).toBe(7_500);

    const tieRes = repo.settleSoloMatch(G, 'u1', 'u2', 1_000, [3, 3, 4], [5, 3, 2]);
    expect(tieRes).toEqual({
      ok: true,
      winnerId: null,
      challengerSum: 10,
      opponentSum: 10,
    });
    expect(repo.ensureUser(G, 'u1').balance).toBe(12_500);
    expect(repo.ensureUser(G, 'u2').balance).toBe(7_500);

    const brokeRes = repo.settleSoloMatch(G, 'u1', 'u2', 8_000, [6, 6, 6], [1, 1, 1]);
    expect(brokeRes.ok).toBe(false);
    expect(repo.ensureUser(G, 'u1').balance).toBe(12_500);
    expect(repo.ensureUser(G, 'u2').balance).toBe(7_500);
  });
});
