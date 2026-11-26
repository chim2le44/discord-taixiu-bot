import type { DailyQuestId } from './types.js';

export interface DailyQuestProgress {
  readonly dateKey: string;
  readonly gamesPlayed: number;
  readonly gamesWon: number;
  readonly totalWagered: number;
  readonly claimedPlay: boolean;
  readonly claimedWin: boolean;
  readonly claimedWager: boolean;
}

export interface QuestDefinition {
  readonly id: DailyQuestId;
  readonly label: string;
  readonly target: number;
  readonly reward: number;
  readonly field: 'gamesPlayed' | 'gamesWon' | 'totalWagered';
  readonly claimedField: 'claimedPlay' | 'claimedWin' | 'claimedWager';
}

export const QUEST_DEFINITIONS: readonly QuestDefinition[] = [
  {
    id: 'play_5',
    label: 'Chơi 5 ván Tài Xỉu',
    target: 5,
    reward: 2_000,
    field: 'gamesPlayed',
    claimedField: 'claimedPlay',
  },
  {
    id: 'win_3',
    label: 'Thắng 3 ván Tài Xỉu',
    target: 3,
    reward: 3_000,
    field: 'gamesWon',
    claimedField: 'claimedWin',
  },
  {
    id: 'wager_10k',
    label: 'Đặt cược tổng 10,000 xu',
    target: 10_000,
    reward: 4_000,
    field: 'totalWagered',
    claimedField: 'claimedWager',
  },
];

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** Returns YYYY-MM-DD in Vietnam time (UTC+7). */
export function getVnDateKey(nowMs: number = Date.now()): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}
