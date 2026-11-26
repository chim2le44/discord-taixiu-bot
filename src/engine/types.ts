export type NumberSide = 'SO_1' | 'SO_2' | 'SO_3' | 'SO_4' | 'SO_5' | 'SO_6';
export type SumSide =
  | 'TONG_3'
  | 'TONG_4'
  | 'TONG_5'
  | 'TONG_6'
  | 'TONG_7'
  | 'TONG_8'
  | 'TONG_9'
  | 'TONG_10'
  | 'TONG_11'
  | 'TONG_12'
  | 'TONG_13'
  | 'TONG_14'
  | 'TONG_15'
  | 'TONG_16'
  | 'TONG_17'
  | 'TONG_18';

export type BetSide = 'TAI' | 'XIU' | 'CHAN' | 'LE' | NumberSide | SumSide;
export type RoundOutcome = 'TAI' | 'XIU' | 'BAO';
export type DiceRoll = readonly [number, number, number];
export type LixiStatus = 'OPEN' | 'COMPLETED' | 'EXPIRED';
export type DailyQuestId = 'play_5' | 'win_3' | 'wager_10k';

export const ALL_BET_SIDES: readonly BetSide[] = [
  'TAI',
  'XIU',
  'CHAN',
  'LE',
  'SO_1',
  'SO_2',
  'SO_3',
  'SO_4',
  'SO_5',
  'SO_6',
  'TONG_3',
  'TONG_4',
  'TONG_5',
  'TONG_6',
  'TONG_7',
  'TONG_8',
  'TONG_9',
  'TONG_10',
  'TONG_11',
  'TONG_12',
  'TONG_13',
  'TONG_14',
  'TONG_15',
  'TONG_16',
  'TONG_17',
  'TONG_18',
] as const;

const BET_SIDE_SET = new Set<string>(ALL_BET_SIDES);

export function isBetSide(value: string): value is BetSide {
  return BET_SIDE_SET.has(value);
}

export function getBetSideLabel(side: BetSide): string {
  if (side === 'TAI') return 'Tài';
  if (side === 'XIU') return 'Xỉu';
  if (side === 'CHAN') return 'Chẵn';
  if (side === 'LE') return 'Lẻ';
  if (side.startsWith('SO_')) return `Số ${side.slice(3)}`;
  return `Tổng ${side.slice(5)}`;
}

export interface BetEntry {
  readonly userId: string;
  readonly side: BetSide;
  readonly amount: number;
}

export interface UserBetSummary {
  readonly side: BetSide;
  readonly amount: number;
  readonly payout: number;
}

export interface UserSettlement {
  readonly userId: string;
  readonly bets: readonly UserBetSummary[];
  readonly totalBet: number;
  readonly payout: number;
  readonly netDelta: number;
  readonly won: boolean;
  readonly newStreak: number;
  readonly streakBonus: number;
  readonly jackpotShare: number;
  readonly newLoseStreak: number;
  readonly newLoseStreakLoss: number;
  readonly consolationBonus: number;
  readonly lostRound: boolean;
}

export interface RoundSettlementResult {
  readonly dice: DiceRoll;
  readonly sum: number;
  readonly outcome: RoundOutcome;
  readonly isBao: boolean;
  readonly isGolden: boolean;
  readonly jackpotAdded: number;
  readonly jackpotPaidOut: number;
  readonly newJackpotPool: number;
  readonly userSettlements: readonly UserSettlement[];
}

export interface RoundTotals {
  readonly taiTotal: number;
  readonly xiuTotal: number;
  readonly chanTotal: number;
  readonly leTotal: number;
  readonly extraTotal: number;
  readonly totalBetCount: number;
}

export interface RoundHistoryItem {
  readonly roundId: number;
  readonly d1: number;
  readonly d2: number;
  readonly d3: number;
  readonly outcome: RoundOutcome;
}

export const GAME_CONFIG = {
  STARTING_BALANCE: 10_000,
  MIN_BET: 100,
  ROUND_DURATION_MS: 35_000,
  SHAKE_DELAY_MS: 1_800,
  DIE_STEP_DELAY_MS: 1_200,
  NEXT_ROUND_DELAY_MS: 5_000,
  MAX_EMPTY_ROUNDS: 2,
  DAILY_AMOUNT: 5_000,
  DAILY_COOLDOWN_MS: 24 * 60 * 60 * 1000,
  NEWBIE_GIFT_AMOUNT: 50_000_000,
  BAILOUT_AMOUNT: 1_500,
  BAILOUT_COOLDOWN_MS: 30 * 60 * 1000,
  TRANSFER_TAX_RATE: 0.05,
  TAI_XIU_MULTIPLIER: 1.9,
  CHAN_LE_MULTIPLIER: 1.9,
  GOLDEN_ROUND_CHANCE: 0.15,
  GOLDEN_TAI_XIU_MULTIPLIER: 2.1,
  GOLDEN_CHAN_LE_MULTIPLIER: 2.1,
  GOLDEN_JACKPOT_POOL_RATE: 0.1,
  NUMBER_MULTIPLIERS: {
    1: 1.9,
    2: 2.8,
    3: 3.6,
  } as Readonly<Record<1 | 2 | 3, number>>,
  SUM_MULTIPLIER_EXTREME: 10.8,
  SUM_MULTIPLIER_MID: 4.5,
  SUM_MULTIPLIER_OTHER: 6.2,
  JACKPOT_POOL_RATE: 0.05,
  JACKPOT_MIN_BET: 100,
  LIXI_EXPIRE_MS: 5 * 60 * 1000,
  LIXI_MIN_TOTAL: 200,
  LIXI_MAX_SLOTS: 50,
  SOLO_EXPIRE_MS: 60 * 1000,
  STREAK_BONUSES: {
    3: 2_000,
    5: 5_000,
    10: 20_000,
  } as Readonly<Record<number, number>>,
  LOSE_STREAK_BADGE_MIN: 3,
  LOSE_STREAK_CONSOLATION: {
    5: { rate: 0.15, max: 15_000 },
    8: { rate: 0.25, max: 30_000 },
  } as Readonly<Record<number, { readonly rate: number; readonly max: number }>>,
} as const;
