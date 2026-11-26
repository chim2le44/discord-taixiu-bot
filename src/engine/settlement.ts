import { classifyRoll } from './dice.js';
import {
  GAME_CONFIG,
  type BetEntry,
  type BetSide,
  type DiceRoll,
  type RoundSettlementResult,
  type UserBetSummary,
  type UserSettlement,
} from './types.js';

export interface LoseStreakState {
  readonly streak: number;
  readonly loss: number;
}

export interface SettlementInput {
  readonly dice: DiceRoll;
  readonly bets: readonly BetEntry[];
  readonly currentJackpot: number;
  readonly userStreaks: ReadonlyMap<string, number>;
  readonly isGolden?: boolean;
  readonly userLoseStreaks?: ReadonlyMap<string, LoseStreakState>;
}

/**
 * Evaluates the base payout (including stake) for a single bet side against a 3-dice roll.
 */
export function evaluateBetPayout(
  side: BetSide,
  amount: number,
  dice: DiceRoll,
  isGolden = false,
): number {
  const sum = dice[0] + dice[1] + dice[2];
  const taiXiuMult = isGolden
    ? GAME_CONFIG.GOLDEN_TAI_XIU_MULTIPLIER
    : GAME_CONFIG.TAI_XIU_MULTIPLIER;
  const chanLeMult = isGolden
    ? GAME_CONFIG.GOLDEN_CHAN_LE_MULTIPLIER
    : GAME_CONFIG.CHAN_LE_MULTIPLIER;

  if (side === 'TAI') {
    return sum >= 11 ? Math.floor(amount * taiXiuMult) : 0;
  }
  if (side === 'XIU') {
    return sum <= 10 ? Math.floor(amount * taiXiuMult) : 0;
  }
  if (side === 'CHAN') {
    return sum % 2 === 0 ? Math.floor(amount * chanLeMult) : 0;
  }
  if (side === 'LE') {
    return sum % 2 === 1 ? Math.floor(amount * chanLeMult) : 0;
  }

  if (side.startsWith('SO_')) {
    const target = Number(side.slice(3));
    let matches = 0;
    for (const d of dice) {
      if (d === target) matches += 1;
    }
    if (matches === 0) return 0;
    const mult = GAME_CONFIG.NUMBER_MULTIPLIERS[matches as 1 | 2 | 3];
    return Math.floor(amount * mult);
  }

  if (side.startsWith('TONG_')) {
    const target = Number(side.slice(5));
    if (sum !== target) return 0;
    if (target === 3 || target === 18) {
      return Math.floor(amount * GAME_CONFIG.SUM_MULTIPLIER_EXTREME);
    }
    if (target >= 9 && target <= 12) {
      return Math.floor(amount * GAME_CONFIG.SUM_MULTIPLIER_MID);
    }
    return Math.floor(amount * GAME_CONFIG.SUM_MULTIPLIER_OTHER);
  }

  return 0;
}

/**
 * Pure round settlement calculation: computes per-side payouts, Jackpot accumulation/split
 * on triples, and win streaks without side effects.
 */
export function settleRound(input: SettlementInput): RoundSettlementResult {
  const { dice, bets, currentJackpot, userStreaks } = input;
  const isGolden = input.isGolden ?? false;
  const { sum, outcome, isBao } = classifyRoll(dice);

  // Aggregate same-user, same-side bets
  const byUser = new Map<string, Map<BetSide, number>>();
  let totalRoundWager = 0;

  for (const bet of bets) {
    totalRoundWager += bet.amount;
    let userMap = byUser.get(bet.userId);
    if (!userMap) {
      userMap = new Map<BetSide, number>();
      byUser.set(bet.userId, userMap);
    }
    userMap.set(bet.side, (userMap.get(bet.side) ?? 0) + bet.amount);
  }

  // First pass: evaluate base payouts and triple-jackpot eligibility
  interface UserEval {
    userId: string;
    bets: UserBetSummary[];
    totalBet: number;
    basePayout: number;
    eligibleJackpotBet: number;
  }

  const evals: UserEval[] = [];
  let totalEligibleWinBet = 0;

  for (const [userId, sideMap] of byUser) {
    const userBets: UserBetSummary[] = [];
    let totalBet = 0;
    let basePayout = 0;
    let eligibleJackpotBet = 0;

    for (const [side, amount] of sideMap) {
      const payout = evaluateBetPayout(side, amount, dice, isGolden);
      userBets.push({ side, amount, payout });
      totalBet += amount;
      basePayout += payout;
      if (isBao && payout > 0 && amount >= GAME_CONFIG.JACKPOT_MIN_BET) {
        eligibleJackpotBet += amount;
      }
    }

    totalEligibleWinBet += eligibleJackpotBet;
    evals.push({ userId, bets: userBets, totalBet, basePayout, eligibleJackpotBet });
  }

  let jackpotAdded = 0;
  let jackpotPaidOut = 0;
  let newJackpotPool = currentJackpot;

  if (!isBao) {
    const jackpotRate = isGolden
      ? GAME_CONFIG.GOLDEN_JACKPOT_POOL_RATE
      : GAME_CONFIG.JACKPOT_POOL_RATE;
    jackpotAdded = Math.floor(totalRoundWager * jackpotRate);
    newJackpotPool = currentJackpot + jackpotAdded;
  }

  const userSettlements: UserSettlement[] = [];

  for (const ev of evals) {
    let jackpotShare = 0;
    if (isBao && totalEligibleWinBet > 0 && currentJackpot > 0 && ev.eligibleJackpotBet > 0) {
      jackpotShare = Math.floor((currentJackpot * ev.eligibleJackpotBet) / totalEligibleWinBet);
      jackpotPaidOut += jackpotShare;
    }

    const payoutBeforeStreak = ev.basePayout + jackpotShare;
    const prevStreak = userStreaks.get(ev.userId) ?? 0;
    const netPositive = payoutBeforeStreak > ev.totalBet;
    const won = netPositive;
    const lostRound = payoutBeforeStreak < ev.totalBet;
    const newStreak = netPositive ? prevStreak + 1 : 0;
    const streakBonus = netPositive ? (GAME_CONFIG.STREAK_BONUSES[newStreak] ?? 0) : 0;

    const prevLose = input.userLoseStreaks?.get(ev.userId) ?? { streak: 0, loss: 0 };
    const newLoseStreak = lostRound ? prevLose.streak + 1 : 0;
    const newLoseStreakLoss = lostRound
      ? prevLose.loss + (ev.totalBet - payoutBeforeStreak)
      : 0;
    const consolationRule = lostRound
      ? GAME_CONFIG.LOSE_STREAK_CONSOLATION[newLoseStreak]
      : undefined;
    const consolationBonus = consolationRule
      ? Math.min(consolationRule.max, Math.floor(newLoseStreakLoss * consolationRule.rate))
      : 0;

    const totalPayout = payoutBeforeStreak + streakBonus + consolationBonus;

    userSettlements.push({
      userId: ev.userId,
      bets: ev.bets,
      totalBet: ev.totalBet,
      payout: totalPayout,
      netDelta: totalPayout - ev.totalBet,
      won,
      newStreak,
      streakBonus,
      jackpotShare,
      newLoseStreak,
      newLoseStreakLoss,
      consolationBonus,
      lostRound,
    });
  }

  if (isBao && jackpotPaidOut > 0) {
    newJackpotPool = currentJackpot - jackpotPaidOut;
  }

  return {
    dice,
    sum,
    outcome,
    isBao,
    isGolden,
    jackpotAdded,
    jackpotPaidOut,
    newJackpotPool,
    userSettlements,
  };
}
