import { describe, expect, it } from 'vitest';
import { classifyRoll } from '../src/engine/dice.js';
import { evaluateBetPayout, settleRound } from '../src/engine/settlement.js';

describe('classifyRoll', () => {
  it('classifies TAI, XIU, and BAO accurately', () => {
    expect(classifyRoll([1, 2, 3])).toEqual({ sum: 6, outcome: 'XIU', isBao: false });
    expect(classifyRoll([4, 3, 3])).toEqual({ sum: 10, outcome: 'XIU', isBao: false });
    expect(classifyRoll([5, 3, 3])).toEqual({ sum: 11, outcome: 'TAI', isBao: false });
    expect(classifyRoll([6, 6, 5])).toEqual({ sum: 17, outcome: 'TAI', isBao: false });
    expect(classifyRoll([1, 1, 1])).toEqual({ sum: 3, outcome: 'BAO', isBao: true });
    expect(classifyRoll([6, 6, 6])).toEqual({ sum: 18, outcome: 'BAO', isBao: true });
  });
});

describe('evaluateBetPayout', () => {
  it('pays x1.9 for TAI/XIU/CHAN/LE, x1.9/x2.8/x3.6 for SO, and x4.5/x6.2/x10.8 for TONG', () => {
    expect(evaluateBetPayout('TAI', 1_000, [5, 3, 3])).toBe(1_900);
    expect(evaluateBetPayout('XIU', 1_000, [5, 3, 3])).toBe(0);
    expect(evaluateBetPayout('LE', 1_000, [5, 3, 3])).toBe(1_900);
    expect(evaluateBetPayout('CHAN', 1_000, [5, 3, 3])).toBe(0);

    // Number bets: 1 match -> x1.9, 2 matches -> x2.8, 3 matches -> x3.6
    expect(evaluateBetPayout('SO_5', 1_000, [5, 3, 3])).toBe(1_900);
    expect(evaluateBetPayout('SO_3', 1_000, [5, 3, 3])).toBe(2_800);
    expect(evaluateBetPayout('SO_6', 1_000, [6, 6, 6])).toBe(3_600);
    expect(evaluateBetPayout('SO_1', 1_000, [5, 3, 3])).toBe(0);

    // Sum bets: 9-12 -> x4.5, 3 & 18 -> x10.8, others -> x6.2
    expect(evaluateBetPayout('TONG_11', 1_000, [5, 3, 3])).toBe(4_500);
    expect(evaluateBetPayout('TONG_3', 1_000, [1, 1, 1])).toBe(10_800);
    expect(evaluateBetPayout('TONG_18', 1_000, [6, 6, 6])).toBe(10_800);
    expect(evaluateBetPayout('TONG_6', 1_000, [1, 2, 3])).toBe(6_200);
  });
});

describe('settleRound', () => {
  it('settles non-triple round with 5% jackpot accumulation and streak bonus', () => {
    const result = settleRound({
      dice: [4, 4, 5], // sum 13 -> TAI + LE
      bets: [
        { userId: 'u1', side: 'TAI', amount: 1_000 },
        { userId: 'u2', side: 'XIU', amount: 1_000 },
      ],
      currentJackpot: 5_000,
      userStreaks: new Map([
        ['u1', 2], // becomes 3 -> +2,000 streak bonus
        ['u2', 4], // loses -> resets to 0
      ]),
    });

    expect(result.outcome).toBe('TAI');
    expect(result.jackpotAdded).toBe(100); // 5% of 2,000
    expect(result.newJackpotPool).toBe(5_100);

    const u1 = result.userSettlements.find((u) => u.userId === 'u1')!;
    expect(u1.won).toBe(true);
    expect(u1.newStreak).toBe(3);
    expect(u1.streakBonus).toBe(2_000);
    // 1,000 * 1.9 + 2,000 streak bonus = 3,900
    expect(u1.payout).toBe(3_900);
    expect(u1.netDelta).toBe(2_900);

    const u2 = result.userSettlements.find((u) => u.userId === 'u2')!;
    expect(u2.won).toBe(false);
    expect(u2.newStreak).toBe(0);
    expect(u2.payout).toBe(0);
  });

  it('splits jackpot proportionally among eligible winning bets when a triple rolls', () => {
    const result = settleRound({
      dice: [6, 6, 6], // sum 18 -> TAI + CHAN + SO_6 + TONG_18
      bets: [
        { userId: 'u1', side: 'TAI', amount: 100 },
        { userId: 'u2', side: 'TONG_18', amount: 200 },
        { userId: 'u3', side: 'XIU', amount: 1_000 }, // loses
      ],
      currentJackpot: 1_000, // u1 gets 333, u2 gets 666, remainder 1 stays
      userStreaks: new Map(),
    });

    expect(result.isBao).toBe(true);
    expect(result.jackpotPaidOut).toBe(999);
    expect(result.newJackpotPool).toBe(1);

    const u1 = result.userSettlements.find((u) => u.userId === 'u1')!;
    const u2 = result.userSettlements.find((u) => u.userId === 'u2')!;
    const u3 = result.userSettlements.find((u) => u.userId === 'u3')!;

    expect(u1.jackpotShare).toBe(333);
    expect(u1.payout).toBe(190 + 333);
    expect(u2.jackpotShare).toBe(666);
    expect(u2.payout).toBe(2_160 + 666);
    expect(u3.payout).toBe(0);
    expect(u3.won).toBe(false);
  });

  it('applies Golden Round x2.1 for TAI/XIU/CHAN/LE and 10% jackpot rate while keeping SO/TONG normal', () => {
    const result = settleRound({
      dice: [5, 3, 3], // sum 11 -> TAI + LE
      bets: [
        { userId: 'u1', side: 'TAI', amount: 1_000 },
        { userId: 'u2', side: 'TONG_11', amount: 1_000 },
        { userId: 'u3', side: 'LE', amount: 1_000 },
      ],
      currentJackpot: 5_000,
      userStreaks: new Map(),
      isGolden: true,
    });

    expect(result.isGolden).toBe(true);
    expect(result.jackpotAdded).toBe(300); // 10% of 3,000
    expect(result.newJackpotPool).toBe(5_300);

    const u1 = result.userSettlements.find((u) => u.userId === 'u1')!;
    const u2 = result.userSettlements.find((u) => u.userId === 'u2')!;
    const u3 = result.userSettlements.find((u) => u.userId === 'u3')!;

    expect(u1.payout).toBe(2_100);
    expect(u2.payout).toBe(4_500);
    expect(u3.payout).toBe(2_100);
  });

  it('tracks lose streaks, caps consolation at 15k/30k, resets on win, and keeps lostRound=true', () => {
    // 3rd loss -> badge only, no consolation
    const loss3 = settleRound({
      dice: [1, 2, 3], // XIU
      bets: [{ userId: 'u1', side: 'TAI', amount: 1_000 }],
      currentJackpot: 0,
      userStreaks: new Map(),
      userLoseStreaks: new Map([['u1', { streak: 2, loss: 2_000 }]]),
    });
    expect(loss3.userSettlements[0].newLoseStreak).toBe(3);
    expect(loss3.userSettlements[0].newLoseStreakLoss).toBe(3_000);
    expect(loss3.userSettlements[0].consolationBonus).toBe(0);
    expect(loss3.userSettlements[0].lostRound).toBe(true);

    // 5th loss with small current bet (1,000) but huge prior losses (200,000) -> 15% capped at 15,000, still lostRound=true
    const loss5 = settleRound({
      dice: [1, 2, 3],
      bets: [{ userId: 'u1', side: 'TAI', amount: 1_000 }],
      currentJackpot: 0,
      userStreaks: new Map(),
      userLoseStreaks: new Map([['u1', { streak: 4, loss: 200_000 }]]),
    });
    expect(loss5.userSettlements[0].newLoseStreak).toBe(5);
    expect(loss5.userSettlements[0].consolationBonus).toBe(15_000);
    expect(loss5.userSettlements[0].payout).toBe(15_000);
    expect(loss5.userSettlements[0].lostRound).toBe(true);

    // 8th loss -> 25% capped at 30,000
    const loss8 = settleRound({
      dice: [1, 2, 3],
      bets: [{ userId: 'u1', side: 'TAI', amount: 1_000 }],
      currentJackpot: 0,
      userStreaks: new Map(),
      userLoseStreaks: new Map([['u1', { streak: 7, loss: 200_000 }]]),
    });
    expect(loss8.userSettlements[0].newLoseStreak).toBe(8);
    expect(loss8.userSettlements[0].consolationBonus).toBe(30_000);

    // Win resets both lose streak and accumulated loss
    const winReset = settleRound({
      dice: [5, 5, 5], // TAI
      bets: [{ userId: 'u1', side: 'TAI', amount: 1_000 }],
      currentJackpot: 0,
      userStreaks: new Map(),
      userLoseStreaks: new Map([['u1', { streak: 5, loss: 10_000 }]]),
    });
    expect(winReset.userSettlements[0].newLoseStreak).toBe(0);
    expect(winReset.userSettlements[0].newLoseStreakLoss).toBe(0);
    expect(winReset.userSettlements[0].lostRound).toBe(false);
    expect(winReset.userSettlements[0].won).toBe(true);

    // Net loss despite hitting a small side bet must count as lost (won=false, lostRound=true)
    const hedgedLoss = settleRound({
      dice: [1, 2, 3], // sum 6 -> XIU + CHAN
      bets: [
        { userId: 'u1', side: 'TAI', amount: 10_000 },
        { userId: 'u1', side: 'CHAN', amount: 100 },
      ],
      currentJackpot: 0,
      userStreaks: new Map([['u1', 2]]),
      userLoseStreaks: new Map(),
    });
    expect(hedgedLoss.userSettlements[0].won).toBe(false);
    expect(hedgedLoss.userSettlements[0].lostRound).toBe(true);
    expect(hedgedLoss.userSettlements[0].newStreak).toBe(0);
    expect(hedgedLoss.userSettlements[0].newLoseStreak).toBe(1);
  });
});
