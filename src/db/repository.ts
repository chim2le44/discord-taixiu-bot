import type { DatabaseSync } from 'node:sqlite';
import { drawLixiAmount } from '../engine/lixi.js';
import { getVnDateKey, QUEST_DEFINITIONS, type DailyQuestProgress } from '../engine/quests.js';
import { evaluateBetPayout, settleRound, type LoseStreakState } from '../engine/settlement.js';
import {
  GAME_CONFIG,
  type BetEntry,
  type BetSide,
  type DiceRoll,
  type LixiStatus,
  type RoundHistoryItem,
  type RoundOutcome,
  type RoundSettlementResult,
  type RoundTotals,
} from '../engine/types.js';
import { withTransaction } from './database.js';

export interface UserRecord {
  readonly guildId: string;
  readonly userId: string;
  readonly balance: number;
  readonly totalGames: number;
  readonly totalWins: number;
  readonly currentStreak: number;
  readonly bestStreak: number;
  readonly currentLoseStreak: number;
  readonly bestLoseStreak: number;
  readonly loseStreakLoss: number;
  readonly netProfit: number;
  readonly lastDailyAt: number;
  readonly lastBailoutAt: number;
  readonly claimedNewbie: boolean;
}

export interface GuildSettingsRecord {
  readonly guildId: string;
  readonly allowedChannelId: string | null;
  readonly jackpotPool: number;
}

export interface LixiPacketRecord {
  readonly id: number;
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string | null;
  readonly creatorId: string;
  readonly totalAmount: number;
  readonly remainingAmount: number;
  readonly totalSlots: number;
  readonly remainingSlots: number;
  readonly status: LixiStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface LixiClaimEntry {
  readonly userId: string;
  readonly amount: number;
  readonly claimedAt: number;
}

export type PlaceBetResult =
  | { readonly ok: true; readonly newBalance: number }
  | { readonly ok: false; readonly error: string };

export type RepeatBetResult =
  | {
      readonly ok: true;
      readonly newBalance: number;
      readonly placed: ReadonlyArray<{ readonly side: BetSide; readonly amount: number }>;
      readonly totalAmount: number;
    }
  | { readonly ok: false; readonly error: string };

export type ClaimResult =
  | { readonly ok: true; readonly amount: number; readonly newBalance: number }
  | { readonly ok: false; readonly error: string; readonly nextAvailableAtMs?: number };

export type TransferResult =
  | {
      readonly ok: true;
      readonly sent: number;
      readonly tax: number;
      readonly received: number;
      readonly senderBalance: number;
    }
  | { readonly ok: false; readonly error: string };

export type CreateLixiResult =
  | { readonly ok: true; readonly packet: LixiPacketRecord; readonly creatorBalance: number }
  | { readonly ok: false; readonly error: string };

export type ClaimLixiResult =
  | {
      readonly ok: true;
      readonly amount: number;
      readonly newBalance: number;
      readonly packet: LixiPacketRecord;
      readonly claims: readonly LixiClaimEntry[];
    }
  | { readonly ok: false; readonly error: string };

export type SoloMatchResult =
  | {
      readonly ok: true;
      readonly winnerId: string | null;
      readonly challengerSum: number;
      readonly opponentSum: number;
    }
  | { readonly ok: false; readonly error: string };

interface RawUserRow {
  guild_id: string;
  user_id: string;
  balance: number;
  total_games: number;
  total_wins: number;
  current_streak: number;
  best_streak: number;
  current_lose_streak: number;
  best_lose_streak: number;
  lose_streak_loss: number;
  net_profit: number;
  last_daily_at: number;
  last_bailout_at: number;
  claimed_newbie: number;
}

interface RawQuestRow {
  date_key: string;
  games_played: number;
  games_won: number;
  total_wagered: number;
  claimed_play: number;
  claimed_win: number;
  claimed_wager: number;
}

interface RawLixiPacketRow {
  id: number;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  creator_id: string;
  total_amount: number;
  remaining_amount: number;
  total_slots: number;
  remaining_slots: number;
  status: LixiStatus;
  created_at: number;
  expires_at: number;
}

function mapUserRow(row: RawUserRow): UserRecord {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    balance: row.balance,
    totalGames: row.total_games,
    totalWins: row.total_wins,
    currentStreak: row.current_streak,
    bestStreak: row.best_streak,
    currentLoseStreak: row.current_lose_streak,
    bestLoseStreak: row.best_lose_streak,
    loseStreakLoss: row.lose_streak_loss,
    netProfit: row.net_profit,
    lastDailyAt: row.last_daily_at,
    lastBailoutAt: row.last_bailout_at,
    claimedNewbie: row.claimed_newbie === 1,
  };
}

function mapQuestRow(row: RawQuestRow): DailyQuestProgress {
  return {
    dateKey: row.date_key,
    gamesPlayed: row.games_played,
    gamesWon: row.games_won,
    totalWagered: row.total_wagered,
    claimedPlay: row.claimed_play === 1,
    claimedWin: row.claimed_win === 1,
    claimedWager: row.claimed_wager === 1,
  };
}

function mapLixiPacket(row: RawLixiPacketRow): LixiPacketRecord {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    creatorId: row.creator_id,
    totalAmount: row.total_amount,
    remainingAmount: row.remaining_amount,
    totalSlots: row.total_slots,
    remainingSlots: row.remaining_slots,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function checkOppositeConflict(side: BetSide, existingSides: Set<BetSide>): string | null {
  if (side === 'TAI' && existingSides.has('XIU')) {
    return 'Không thể đặt cả Tài lẫn Xỉu trong cùng một phiên.';
  }
  if (side === 'XIU' && existingSides.has('TAI')) {
    return 'Không thể đặt cả Tài lẫn Xỉu trong cùng một phiên.';
  }
  if (side === 'CHAN' && existingSides.has('LE')) {
    return 'Không thể đặt cả Chẵn lẫn Lẻ trong cùng một phiên.';
  }
  if (side === 'LE' && existingSides.has('CHAN')) {
    return 'Không thể đặt cả Chẵn lẫn Lẻ trong cùng một phiên.';
  }
  return null;
}

export class Repository {
  constructor(private readonly db: DatabaseSync) {}

  private ensureUserRow(guildId: string, userId: string): RawUserRow {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (guild_id, user_id, balance)
         VALUES (?, ?, ?)`,
      )
      .run(guildId, userId, GAME_CONFIG.STARTING_BALANCE);

    return this.db
      .prepare(`SELECT * FROM users WHERE guild_id = ? AND user_id = ?`)
      .get(guildId, userId) as unknown as RawUserRow;
  }

  private ensureGuildSettingsRow(guildId: string): {
    guild_id: string;
    allowed_channel_id: string | null;
    jackpot_pool: number;
  } {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO guild_settings (guild_id, allowed_channel_id, jackpot_pool)
         VALUES (?, NULL, 0)`,
      )
      .run(guildId);

    return this.db
      .prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`)
      .get(guildId) as unknown as {
      guild_id: string;
      allowed_channel_id: string | null;
      jackpot_pool: number;
    };
  }

  private ensureQuestRow(guildId: string, userId: string, dateKey: string): RawQuestRow {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO daily_quests (guild_id, user_id, date_key)
         VALUES (?, ?, ?)`,
      )
      .run(guildId, userId, dateKey);

    return this.db
      .prepare(
        `SELECT date_key, games_played, games_won, total_wagered, claimed_play, claimed_win, claimed_wager
         FROM daily_quests
         WHERE guild_id = ? AND user_id = ? AND date_key = ?`,
      )
      .get(guildId, userId, dateKey) as unknown as RawQuestRow;
  }

  ensureUser(guildId: string, userId: string): UserRecord {
    return withTransaction(this.db, () => mapUserRow(this.ensureUserRow(guildId, userId)));
  }

  getGuildSettings(guildId: string): GuildSettingsRecord {
    return withTransaction(this.db, () => {
      const row = this.ensureGuildSettingsRow(guildId);
      return {
        guildId: row.guild_id,
        allowedChannelId: row.allowed_channel_id,
        jackpotPool: row.jackpot_pool,
      };
    });
  }

  setAllowedChannel(guildId: string, channelId: string | null): void {
    withTransaction(this.db, () => {
      this.ensureGuildSettingsRow(guildId);
      this.db
        .prepare(`UPDATE guild_settings SET allowed_channel_id = ? WHERE guild_id = ?`)
        .run(channelId, guildId);
    });
  }

  createRound(guildId: string, channelId: string, isGolden = false): number {
    const res = this.db
      .prepare(
        `INSERT INTO rounds (guild_id, channel_id, status, is_golden, created_at)
         VALUES (?, ?, 'OPEN', ?, ?)`,
      )
      .run(guildId, channelId, isGolden ? 1 : 0, Date.now());
    return Number(res.lastInsertRowid);
  }

  isRoundGolden(roundId: number): boolean {
    const row = this.db
      .prepare(`SELECT is_golden FROM rounds WHERE id = ?`)
      .get(roundId) as { is_golden: number } | undefined;
    return row?.is_golden === 1;
  }

  getRoundTotals(roundId: number): RoundTotals {
    const rows = this.db
      .prepare(
        `SELECT side, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
         FROM bets WHERE round_id = ? GROUP BY side`,
      )
      .all(roundId) as Array<{ side: BetSide; total: number; cnt: number }>;

    let taiTotal = 0;
    let xiuTotal = 0;
    let chanTotal = 0;
    let leTotal = 0;
    let extraTotal = 0;
    let totalBetCount = 0;

    for (const r of rows) {
      totalBetCount += r.cnt;
      if (r.side === 'TAI') taiTotal += r.total;
      else if (r.side === 'XIU') xiuTotal += r.total;
      else if (r.side === 'CHAN') chanTotal += r.total;
      else if (r.side === 'LE') leTotal += r.total;
      else extraTotal += r.total;
    }

    return { taiTotal, xiuTotal, chanTotal, leTotal, extraTotal, totalBetCount };
  }

  getRecentHistory(guildId: string, limit = 20): RoundHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT id, d1, d2, d3, outcome
         FROM rounds
         WHERE guild_id = ? AND status = 'SETTLED' AND outcome IS NOT NULL
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(guildId, limit) as Array<{
      id: number;
      d1: number;
      d2: number;
      d3: number;
      outcome: RoundOutcome;
    }>;

    return rows
      .reverse()
      .map((r) => ({ roundId: r.id, d1: r.d1, d2: r.d2, d3: r.d3, outcome: r.outcome }));
  }

  placeBet(
    guildId: string,
    roundId: number,
    userId: string,
    side: BetSide,
    amount: number,
  ): PlaceBetResult {
    if (!Number.isSafeInteger(amount) || amount < GAME_CONFIG.MIN_BET) {
      return {
        ok: false,
        error: `Mức cược tối thiểu là ${GAME_CONFIG.MIN_BET.toLocaleString('en-US')} xu.`,
      };
    }

    return withTransaction(this.db, () => {
      const round = this.db
        .prepare(`SELECT id, guild_id, status FROM rounds WHERE id = ?`)
        .get(roundId) as { id: number; guild_id: string; status: string } | undefined;

      if (!round || round.guild_id !== guildId || round.status !== 'OPEN') {
        return { ok: false, error: 'Phiên cược này đã đóng hoặc không tồn tại.' };
      }

      const user = this.ensureUserRow(guildId, userId);
      if (user.balance < amount) {
        return {
          ok: false,
          error: `Số dư không đủ (hiện có ${user.balance.toLocaleString('en-US')} xu).`,
        };
      }

      const existingSides = new Set(
        (
          this.db
            .prepare(`SELECT DISTINCT side FROM bets WHERE round_id = ? AND user_id = ?`)
            .all(roundId, userId) as Array<{ side: BetSide }>
        ).map((r) => r.side),
      );
      const conflictErr = checkOppositeConflict(side, existingSides);
      if (conflictErr) {
        return { ok: false, error: conflictErr };
      }

      const newBalance = user.balance - amount;
      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(newBalance, guildId, userId);

      this.db
        .prepare(
          `INSERT INTO bets (round_id, guild_id, user_id, side, amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(roundId, guildId, userId, side, amount, Date.now());

      return { ok: true, newBalance };
    });
  }

  repeatLastBet(guildId: string, roundId: number, userId: string): RepeatBetResult {
    return withTransaction(this.db, () => {
      const round = this.db
        .prepare(`SELECT id, guild_id, status FROM rounds WHERE id = ?`)
        .get(roundId) as { id: number; guild_id: string; status: string } | undefined;

      if (!round || round.guild_id !== guildId || round.status !== 'OPEN') {
        return { ok: false, error: 'Phiên cược này đã đóng hoặc không tồn tại.' };
      }

      const prevRound = this.db
        .prepare(
          `SELECT r.id
           FROM rounds r
           JOIN bets b ON b.round_id = r.id
           WHERE r.guild_id = ? AND r.status = 'SETTLED' AND b.user_id = ?
           ORDER BY r.id DESC
           LIMIT 1`,
        )
        .get(guildId, userId) as { id: number } | undefined;

      if (!prevRound) {
        return { ok: false, error: 'Bạn chưa có phiên trước đó để cược lại.' };
      }

      const prevBets = this.db
        .prepare(
          `SELECT side, SUM(amount) AS amount
           FROM bets
           WHERE round_id = ? AND user_id = ?
           GROUP BY side`,
        )
        .all(prevRound.id, userId) as Array<{ side: BetSide; amount: number }>;

      const totalAmount = prevBets.reduce((sum, b) => sum + b.amount, 0);
      const user = this.ensureUserRow(guildId, userId);
      if (user.balance < totalAmount) {
        return {
          ok: false,
          error: `Không đủ xu để cược lại (cần ${totalAmount.toLocaleString('en-US')} xu, hiện có ${user.balance.toLocaleString('en-US')} xu).`,
        };
      }

      const existingSides = new Set(
        (
          this.db
            .prepare(`SELECT DISTINCT side FROM bets WHERE round_id = ? AND user_id = ?`)
            .all(roundId, userId) as Array<{ side: BetSide }>
        ).map((r) => r.side),
      );

      for (const b of prevBets) {
        const conflictErr = checkOppositeConflict(b.side, existingSides);
        if (conflictErr) {
          return { ok: false, error: conflictErr };
        }
      }

      const newBalance = user.balance - totalAmount;
      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(newBalance, guildId, userId);

      const now = Date.now();
      const insertBet = this.db.prepare(
        `INSERT INTO bets (round_id, guild_id, user_id, side, amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const b of prevBets) {
        insertBet.run(roundId, guildId, userId, b.side, b.amount, now);
      }

      return {
        ok: true,
        newBalance,
        placed: prevBets,
        totalAmount,
      };
    });
  }

  settleRoundInDb(
    guildId: string,
    roundId: number,
    dice: DiceRoll,
    nowMs = Date.now(),
  ): {
    settlement: RoundSettlementResult;
    totalBets: number;
    userBalances: ReadonlyMap<string, number>;
  } {
    return withTransaction(this.db, () => {
      const round = this.db
        .prepare(`SELECT id, guild_id, status, is_golden FROM rounds WHERE id = ?`)
        .get(roundId) as
        | { id: number; guild_id: string; status: string; is_golden: number }
        | undefined;

      if (!round || round.guild_id !== guildId || round.status !== 'OPEN') {
        throw new Error(`Round ${roundId} is not open for guild ${guildId}`);
      }

      const isGolden = round.is_golden === 1;
      const settings = this.ensureGuildSettingsRow(guildId);
      const rawBets = this.db
        .prepare(`SELECT id, user_id, side, amount FROM bets WHERE round_id = ?`)
        .all(roundId) as Array<{ id: number; user_id: string; side: BetSide; amount: number }>;

      const bets: BetEntry[] = rawBets.map((b) => ({
        userId: b.user_id,
        side: b.side,
        amount: b.amount,
      }));

      const userStreaks = new Map<string, number>();
      const userLoseStreaks = new Map<string, LoseStreakState>();
      const distinctUsers = new Set(bets.map((b) => b.userId));
      const selectStreak = this.db.prepare(
        `SELECT current_streak, current_lose_streak, lose_streak_loss
         FROM users
         WHERE guild_id = ? AND user_id = ?`,
      );
      for (const uid of distinctUsers) {
        const row = selectStreak.get(guildId, uid) as
          | { current_streak: number; current_lose_streak: number; lose_streak_loss: number }
          | undefined;
        userStreaks.set(uid, row?.current_streak ?? 0);
        userLoseStreaks.set(uid, {
          streak: row?.current_lose_streak ?? 0,
          loss: row?.lose_streak_loss ?? 0,
        });
      }

      const settlement = settleRound({
        dice,
        bets,
        currentJackpot: settings.jackpot_pool,
        userStreaks,
        isGolden,
        userLoseStreaks,
      });

      this.db
        .prepare(
          `UPDATE rounds
           SET status = 'SETTLED', d1 = ?, d2 = ?, d3 = ?, outcome = ?, jackpot_payout = ?, settled_at = ?
           WHERE id = ?`,
        )
        .run(
          dice[0],
          dice[1],
          dice[2],
          settlement.outcome,
          settlement.jackpotPaidOut,
          nowMs,
          roundId,
        );

      this.db
        .prepare(`UPDATE guild_settings SET jackpot_pool = ? WHERE guild_id = ?`)
        .run(settlement.newJackpotPool, guildId);

      const updateUser = this.db.prepare(
        `UPDATE users
         SET balance = balance + ?,
             total_games = total_games + ?,
             total_wins = total_wins + ?,
             current_streak = ?,
             best_streak = MAX(best_streak, ?),
             current_lose_streak = ?,
             best_lose_streak = MAX(best_lose_streak, ?),
             lose_streak_loss = ?,
             net_profit = net_profit + ?
         WHERE guild_id = ? AND user_id = ?`,
      );

      const updateBetPayout = this.db.prepare(`UPDATE bets SET payout = ? WHERE id = ?`);
      const dateKey = getVnDateKey(nowMs);
      const upsertQuest = this.db.prepare(
        `INSERT INTO daily_quests (guild_id, user_id, date_key, games_played, games_won, total_wagered)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id, date_key) DO UPDATE SET
           games_played = games_played + excluded.games_played,
           games_won = games_won + excluded.games_won,
           total_wagered = total_wagered + excluded.total_wagered`,
      );

      for (const u of settlement.userSettlements) {
        updateUser.run(
          u.payout,
          1,
          u.won ? 1 : 0,
          u.newStreak,
          u.newStreak,
          u.newLoseStreak,
          u.newLoseStreak,
          u.newLoseStreakLoss,
          u.netDelta,
          guildId,
          u.userId,
        );

        upsertQuest.run(guildId, u.userId, dateKey, 1, u.won ? 1 : 0, u.totalBet);

        const userBetRows = rawBets.filter((b) => b.user_id === u.userId);
        let extraAdded = false;
        const extra = u.jackpotShare + u.streakBonus + u.consolationBonus;
        for (let i = 0; i < userBetRows.length; i += 1) {
          const b = userBetRows[i];
          const base = evaluateBetPayout(b.side, b.amount, dice, isGolden);
          const isLast = i === userBetRows.length - 1;
          if (!extraAdded && extra > 0 && (base > 0 || isLast)) {
            updateBetPayout.run(base + extra, b.id);
            extraAdded = true;
          } else {
            updateBetPayout.run(base, b.id);
          }
        }
      }

      const userBalances = new Map<string, number>();
      const selectBalance = this.db.prepare(
        `SELECT balance FROM users WHERE guild_id = ? AND user_id = ?`,
      );
      for (const u of settlement.userSettlements) {
        const balRow = selectBalance.get(guildId, u.userId) as { balance: number } | undefined;
        if (balRow) {
          userBalances.set(u.userId, balRow.balance);
        }
      }

      return { settlement, totalBets: rawBets.length, userBalances };
    });
  }

  refundOpenRounds(): { refundedRounds: number; refundedBets: number; refundedAmount: number } {
    return withTransaction(this.db, () => {
      const openRounds = this.db
        .prepare(`SELECT id FROM rounds WHERE status = 'OPEN'`)
        .all() as Array<{ id: number }>;

      let refundedBets = 0;
      let refundedAmount = 0;

      const selectBets = this.db.prepare(
        `SELECT id, guild_id, user_id, amount FROM bets WHERE round_id = ?`,
      );
      const refundUser = this.db.prepare(
        `UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`,
      );
      const markBetRefunded = this.db.prepare(`UPDATE bets SET payout = amount WHERE id = ?`);
      const markRoundCancelled = this.db.prepare(
        `UPDATE rounds SET status = 'CANCELLED', settled_at = ? WHERE id = ?`,
      );

      const now = Date.now();
      for (const r of openRounds) {
        const bets = selectBets.all(r.id) as Array<{
          id: number;
          guild_id: string;
          user_id: string;
          amount: number;
        }>;

        for (const b of bets) {
          refundUser.run(b.amount, b.guild_id, b.user_id);
          markBetRefunded.run(b.id);
          refundedBets += 1;
          refundedAmount += b.amount;
        }
        markRoundCancelled.run(now, r.id);
      }

      return { refundedRounds: openRounds.length, refundedBets, refundedAmount };
    });
  }

  claimDaily(guildId: string, userId: string, nowMs = Date.now()): ClaimResult {
    return withTransaction(this.db, () => {
      const user = this.ensureUserRow(guildId, userId);
      const nextAvailable = user.last_daily_at + GAME_CONFIG.DAILY_COOLDOWN_MS;
      if (user.last_daily_at > 0 && nowMs < nextAvailable) {
        return {
          ok: false,
          error: 'Bạn đã điểm danh hôm nay rồi.',
          nextAvailableAtMs: nextAvailable,
        };
      }

      const newBalance = user.balance + GAME_CONFIG.DAILY_AMOUNT;
      this.db
        .prepare(
          `UPDATE users SET balance = ?, last_daily_at = ? WHERE guild_id = ? AND user_id = ?`,
        )
        .run(newBalance, nowMs, guildId, userId);

      return { ok: true, amount: GAME_CONFIG.DAILY_AMOUNT, newBalance };
    });
  }

  claimBailout(guildId: string, userId: string, nowMs = Date.now()): ClaimResult {
    return withTransaction(this.db, () => {
      const user = this.ensureUserRow(guildId, userId);
      if (user.balance > 0) {
        return {
          ok: false,
          error: `Chỉ được nhận cứu trợ khi số dư về 0 xu (bạn đang có ${user.balance.toLocaleString('en-US')} xu).`,
        };
      }

      const pendingBet = this.db
        .prepare(
          `SELECT 1
           FROM bets b
           JOIN rounds r ON r.id = b.round_id
           WHERE b.guild_id = ? AND b.user_id = ? AND r.status = 'OPEN'
           LIMIT 1`,
        )
        .get(guildId, userId);

      if (pendingBet) {
        return {
          ok: false,
          error: 'Bạn đang có tiền cược chưa mở bát ở phiên hiện tại, hãy chờ hết phiên.',
        };
      }

      const nextAvailable = user.last_bailout_at + GAME_CONFIG.BAILOUT_COOLDOWN_MS;
      if (user.last_bailout_at > 0 && nowMs < nextAvailable) {
        return {
          ok: false,
          error: 'Bạn vừa nhận cứu trợ gần đây.',
          nextAvailableAtMs: nextAvailable,
        };
      }

      const newBalance = GAME_CONFIG.BAILOUT_AMOUNT;
      this.db
        .prepare(
          `UPDATE users SET balance = ?, last_bailout_at = ? WHERE guild_id = ? AND user_id = ?`,
        )
        .run(newBalance, nowMs, guildId, userId);

      return { ok: true, amount: GAME_CONFIG.BAILOUT_AMOUNT, newBalance };
    });
  }

  claimNewbieGift(guildId: string, userId: string): ClaimResult {
    return withTransaction(this.db, () => {
      const user = this.ensureUserRow(guildId, userId);
      if (user.claimed_newbie === 1) {
        return {
          ok: false,
          error: 'Bạn đã nhận quà tân thủ rồi (mỗi người chỉ nhận 1 lần).',
        };
      }

      const newBalance = user.balance + GAME_CONFIG.NEWBIE_GIFT_AMOUNT;
      this.db
        .prepare(
          `UPDATE users SET balance = ?, claimed_newbie = 1 WHERE guild_id = ? AND user_id = ?`,
        )
        .run(newBalance, guildId, userId);

      return { ok: true, amount: GAME_CONFIG.NEWBIE_GIFT_AMOUNT, newBalance };
    });
  }

  transferCoins(
    guildId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
  ): TransferResult {
    if (fromUserId === toUserId) {
      return { ok: false, error: 'Không thể tự chuyển xu cho chính mình.' };
    }
    if (!Number.isSafeInteger(amount) || amount < GAME_CONFIG.MIN_BET) {
      return {
        ok: false,
        error: `Số xu chuyển tối thiểu là ${GAME_CONFIG.MIN_BET.toLocaleString('en-US')} xu.`,
      };
    }

    return withTransaction(this.db, () => {
      const sender = this.ensureUserRow(guildId, fromUserId);
      if (sender.balance < amount) {
        return {
          ok: false,
          error: `Số dư không đủ (hiện có ${sender.balance.toLocaleString('en-US')} xu).`,
        };
      }

      this.ensureUserRow(guildId, toUserId);
      this.ensureGuildSettingsRow(guildId);

      const tax = Math.floor(amount * GAME_CONFIG.TRANSFER_TAX_RATE);
      const received = amount - tax;
      const senderBalance = sender.balance - amount;

      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(senderBalance, guildId, fromUserId);
      this.db
        .prepare(`UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`)
        .run(received, guildId, toUserId);
      this.db
        .prepare(`UPDATE guild_settings SET jackpot_pool = jackpot_pool + ? WHERE guild_id = ?`)
        .run(tax, guildId);

      return { ok: true, sent: amount, tax, received, senderBalance };
    });
  }

  adminAdjustCoins(
    guildId: string,
    userId: string,
    delta: number,
  ): { previousBalance: number; newBalance: number } {
    return withTransaction(this.db, () => {
      const user = this.ensureUserRow(guildId, userId);
      const newBalance = Math.max(0, user.balance + delta);
      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(newBalance, guildId, userId);
      return { previousBalance: user.balance, newBalance };
    });
  }

  getLeaderboard(
    guildId: string,
    by: 'balance' | 'streak' | 'lose_streak',
    limit = 10,
  ): UserRecord[] {
    if (by === 'lose_streak') {
      const rows = this.db
        .prepare(
          `SELECT * FROM users
           WHERE guild_id = ? AND best_lose_streak >= ?
           ORDER BY best_lose_streak DESC, balance ASC
           LIMIT ?`,
        )
        .all(guildId, GAME_CONFIG.LOSE_STREAK_BADGE_MIN, limit) as unknown as RawUserRow[];

      return rows.map(mapUserRow);
    }

    const orderCol =
      by === 'balance' ? 'balance DESC, total_wins DESC' : 'best_streak DESC, balance DESC';
    const rows = this.db
      .prepare(
        `SELECT * FROM users
         WHERE guild_id = ?
         ORDER BY ${orderCol}
         LIMIT ?`,
      )
      .all(guildId, limit) as unknown as RawUserRow[];

    return rows.map(mapUserRow);
  }

  getDailyQuests(guildId: string, userId: string, nowMs = Date.now()): DailyQuestProgress {
    return withTransaction(this.db, () => {
      this.ensureUserRow(guildId, userId);
      const dateKey = getVnDateKey(nowMs);
      return mapQuestRow(this.ensureQuestRow(guildId, userId, dateKey));
    });
  }

  claimDailyQuestRewards(
    guildId: string,
    userId: string,
    nowMs = Date.now(),
  ): {
    claimedRewards: Array<{ label: string; reward: number }>;
    totalReward: number;
    newBalance: number;
    progress: DailyQuestProgress;
  } {
    return withTransaction(this.db, () => {
      const user = this.ensureUserRow(guildId, userId);
      const dateKey = getVnDateKey(nowMs);
      const row = this.ensureQuestRow(guildId, userId, dateKey);
      const progress = mapQuestRow(row);

      const claimedRewards: Array<{ label: string; reward: number }> = [];
      let totalReward = 0;

      const nextFlags = {
        claimedPlay: row.claimed_play,
        claimedWin: row.claimed_win,
        claimedWager: row.claimed_wager,
      };

      for (const def of QUEST_DEFINITIONS) {
        const currentVal = progress[def.field];
        const alreadyClaimed = progress[def.claimedField];
        if (!alreadyClaimed && currentVal >= def.target) {
          claimedRewards.push({ label: def.label, reward: def.reward });
          totalReward += def.reward;
          if (def.claimedField === 'claimedPlay') nextFlags.claimedPlay = 1;
          if (def.claimedField === 'claimedWin') nextFlags.claimedWin = 1;
          if (def.claimedField === 'claimedWager') nextFlags.claimedWager = 1;
        }
      }

      if (totalReward > 0) {
        this.db
          .prepare(
            `UPDATE daily_quests
             SET claimed_play = ?, claimed_win = ?, claimed_wager = ?
             WHERE guild_id = ? AND user_id = ? AND date_key = ?`,
          )
          .run(
            nextFlags.claimedPlay,
            nextFlags.claimedWin,
            nextFlags.claimedWager,
            guildId,
            userId,
            dateKey,
          );

        this.db
          .prepare(`UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`)
          .run(totalReward, guildId, userId);
      }

      const updatedRow = this.ensureQuestRow(guildId, userId, dateKey);
      return {
        claimedRewards,
        totalReward,
        newBalance: user.balance + totalReward,
        progress: mapQuestRow(updatedRow),
      };
    });
  }

  createLixiPacket(
    guildId: string,
    channelId: string,
    creatorId: string,
    totalAmount: number,
    totalSlots: number,
    nowMs = Date.now(),
  ): CreateLixiResult {
    if (!Number.isSafeInteger(totalAmount) || totalAmount < GAME_CONFIG.LIXI_MIN_TOTAL) {
      return {
        ok: false,
        error: `Tổng xu lì xì tối thiểu là ${GAME_CONFIG.LIXI_MIN_TOTAL.toLocaleString('en-US')} xu.`,
      };
    }
    if (
      !Number.isSafeInteger(totalSlots) ||
      totalSlots < 1 ||
      totalSlots > GAME_CONFIG.LIXI_MAX_SLOTS
    ) {
      return {
        ok: false,
        error: `Số suất lì xì phải từ 1 đến ${GAME_CONFIG.LIXI_MAX_SLOTS}.`,
      };
    }
    if (totalAmount < totalSlots) {
      return { ok: false, error: 'Tổng xu phải lớn hơn hoặc bằng số suất lì xì.' };
    }

    return withTransaction(this.db, () => {
      const creator = this.ensureUserRow(guildId, creatorId);
      if (creator.balance < totalAmount) {
        return {
          ok: false,
          error: `Số dư không đủ (hiện có ${creator.balance.toLocaleString('en-US')} xu).`,
        };
      }

      const creatorBalance = creator.balance - totalAmount;
      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(creatorBalance, guildId, creatorId);

      const expiresAt = nowMs + GAME_CONFIG.LIXI_EXPIRE_MS;
      const res = this.db
        .prepare(
          `INSERT INTO lixi_packets (
             guild_id, channel_id, message_id, creator_id,
             total_amount, remaining_amount, total_slots, remaining_slots,
             status, created_at, expires_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
        )
        .run(
          guildId,
          channelId,
          creatorId,
          totalAmount,
          totalAmount,
          totalSlots,
          totalSlots,
          nowMs,
          expiresAt,
        );

      const packetId = Number(res.lastInsertRowid);
      const row = this.db
        .prepare(`SELECT * FROM lixi_packets WHERE id = ?`)
        .get(packetId) as unknown as RawLixiPacketRow;

      return { ok: true, packet: mapLixiPacket(row), creatorBalance };
    });
  }

  setLixiMessageId(packetId: number, messageId: string): void {
    this.db
      .prepare(`UPDATE lixi_packets SET message_id = ? WHERE id = ?`)
      .run(messageId, packetId);
  }

  claimLixiPacket(packetId: number, userId: string, nowMs = Date.now()): ClaimLixiResult {
    return withTransaction(this.db, () => {
      const row = this.db
        .prepare(`SELECT * FROM lixi_packets WHERE id = ?`)
        .get(packetId) as unknown as RawLixiPacketRow | undefined;

      if (!row) {
        return { ok: false, error: 'Bao lì xì này không tồn tại.' };
      }

      if (row.status === 'OPEN' && nowMs >= row.expires_at) {
        if (row.remaining_amount > 0) {
          this.ensureUserRow(row.guild_id, row.creator_id);
          this.db
            .prepare(`UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`)
            .run(row.remaining_amount, row.guild_id, row.creator_id);
        }
        this.db
          .prepare(
            `UPDATE lixi_packets SET status = 'EXPIRED', remaining_amount = 0 WHERE id = ?`,
          )
          .run(packetId);
        return { ok: false, error: 'Bao lì xì đã hết hạn.' };
      }

      if (row.status !== 'OPEN' || row.remaining_slots <= 0) {
        return { ok: false, error: 'Bao lì xì đã hết lượt giật rồi!' };
      }

      const existing = this.db
        .prepare(`SELECT 1 FROM lixi_claims WHERE packet_id = ? AND user_id = ? LIMIT 1`)
        .get(packetId, userId);
      if (existing) {
        return { ok: false, error: 'Bạn đã giật bao lì xì này rồi!' };
      }

      const amount = drawLixiAmount(row.remaining_amount, row.remaining_slots);
      const nextRemainingAmount = row.remaining_amount - amount;
      const nextRemainingSlots = row.remaining_slots - 1;
      const nextStatus: LixiStatus = nextRemainingSlots === 0 ? 'COMPLETED' : 'OPEN';

      const user = this.ensureUserRow(row.guild_id, userId);
      const newBalance = user.balance + amount;

      this.db
        .prepare(`UPDATE users SET balance = ? WHERE guild_id = ? AND user_id = ?`)
        .run(newBalance, row.guild_id, userId);

      this.db
        .prepare(
          `INSERT INTO lixi_claims (packet_id, user_id, amount, claimed_at)
           VALUES (?, ?, ?, ?)`,
        )
        .run(packetId, userId, amount, nowMs);

      this.db
        .prepare(
          `UPDATE lixi_packets
           SET remaining_amount = ?, remaining_slots = ?, status = ?
           WHERE id = ?`,
        )
        .run(nextRemainingAmount, nextRemainingSlots, nextStatus, packetId);

      const updatedPacket = this.db
        .prepare(`SELECT * FROM lixi_packets WHERE id = ?`)
        .get(packetId) as unknown as RawLixiPacketRow;

      const claims = this.db
        .prepare(
          `SELECT user_id, amount, claimed_at
           FROM lixi_claims
           WHERE packet_id = ?
           ORDER BY id ASC`,
        )
        .all(packetId) as Array<{ user_id: string; amount: number; claimed_at: number }>;

      return {
        ok: true,
        amount,
        newBalance,
        packet: mapLixiPacket(updatedPacket),
        claims: claims.map((c) => ({
          userId: c.user_id,
          amount: c.amount,
          claimedAt: c.claimed_at,
        })),
      };
    });
  }

  getLixiPacketWithClaims(packetId: number): {
    packet: LixiPacketRecord;
    claims: LixiClaimEntry[];
  } | null {
    const row = this.db
      .prepare(`SELECT * FROM lixi_packets WHERE id = ?`)
      .get(packetId) as unknown as RawLixiPacketRow | undefined;
    if (!row) return null;

    const claims = this.db
      .prepare(
        `SELECT user_id, amount, claimed_at
         FROM lixi_claims
         WHERE packet_id = ?
         ORDER BY id ASC`,
      )
      .all(packetId) as Array<{ user_id: string; amount: number; claimed_at: number }>;

    return {
      packet: mapLixiPacket(row),
      claims: claims.map((c) => ({
        userId: c.user_id,
        amount: c.amount,
        claimedAt: c.claimed_at,
      })),
    };
  }

  getOpenLixiPackets(): LixiPacketRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM lixi_packets WHERE status = 'OPEN'`)
      .all() as unknown as RawLixiPacketRow[];
    return rows.map(mapLixiPacket);
  }

  expireLixiPackets(nowMs = Date.now(), packetId?: number): {
    expiredCount: number;
    refundedAmount: number;
    packets: LixiPacketRecord[];
  } {
    return withTransaction(this.db, () => {
      const openPackets = (
        packetId !== undefined
          ? this.db
              .prepare(`SELECT * FROM lixi_packets WHERE id = ? AND status = 'OPEN'`)
              .all(packetId)
          : this.db
              .prepare(`SELECT * FROM lixi_packets WHERE status = 'OPEN' AND expires_at <= ?`)
              .all(nowMs)
      ) as unknown as RawLixiPacketRow[];

      let refundedAmount = 0;
      const expired: LixiPacketRecord[] = [];
      const refundUser = this.db.prepare(
        `UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`,
      );
      const markExpired = this.db.prepare(
        `UPDATE lixi_packets SET status = 'EXPIRED', remaining_amount = 0 WHERE id = ?`,
      );

      for (const p of openPackets) {
        if (p.remaining_amount > 0) {
          this.ensureUserRow(p.guild_id, p.creator_id);
          refundUser.run(p.remaining_amount, p.guild_id, p.creator_id);
          refundedAmount += p.remaining_amount;
        }
        markExpired.run(p.id);
        const updated = this.db
          .prepare(`SELECT * FROM lixi_packets WHERE id = ?`)
          .get(p.id) as unknown as RawLixiPacketRow;
        expired.push(mapLixiPacket(updated));
      }

      return { expiredCount: expired.length, refundedAmount, packets: expired };
    });
  }

  settleSoloMatch(
    guildId: string,
    challengerId: string,
    opponentId: string,
    amount: number,
    challengerDice: DiceRoll,
    opponentDice: DiceRoll,
  ): SoloMatchResult {
    if (challengerId === opponentId) {
      return { ok: false, error: 'Không thể tự solo với chính mình.' };
    }
    if (!Number.isSafeInteger(amount) || amount < GAME_CONFIG.MIN_BET) {
      return {
        ok: false,
        error: `Mức cược solo tối thiểu là ${GAME_CONFIG.MIN_BET.toLocaleString('en-US')} xu.`,
      };
    }

    return withTransaction(this.db, () => {
      const challenger = this.ensureUserRow(guildId, challengerId);
      const opponent = this.ensureUserRow(guildId, opponentId);

      if (challenger.balance < amount) {
        return {
          ok: false,
          error: `<@${challengerId}> không đủ ${amount.toLocaleString('en-US')} xu để theo kèo.`,
        };
      }
      if (opponent.balance < amount) {
        return {
          ok: false,
          error: `<@${opponentId}> không đủ ${amount.toLocaleString('en-US')} xu để theo kèo.`,
        };
      }

      const challengerSum = challengerDice[0] + challengerDice[1] + challengerDice[2];
      const opponentSum = opponentDice[0] + opponentDice[1] + opponentDice[2];

      let winnerId: string | null = null;
      if (challengerSum > opponentSum) {
        winnerId = challengerId;
        this.db
          .prepare(`UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`)
          .run(amount, guildId, challengerId);
        this.db
          .prepare(`UPDATE users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?`)
          .run(amount, guildId, opponentId);
      } else if (opponentSum > challengerSum) {
        winnerId = opponentId;
        this.db
          .prepare(`UPDATE users SET balance = balance + ? WHERE guild_id = ? AND user_id = ?`)
          .run(amount, guildId, opponentId);
        this.db
          .prepare(`UPDATE users SET balance = balance - ? WHERE guild_id = ? AND user_id = ?`)
          .run(amount, guildId, challengerId);
      }

      return { ok: true, winnerId, challengerSum, opponentSum };
    });
  }
}
