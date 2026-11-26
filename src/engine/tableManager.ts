import { rollDice } from './dice.js';
import { GAME_CONFIG, type DiceRoll } from './types.js';

export type TablePhase = 'BETTING' | 'REVEALING' | 'COOLDOWN';

export interface ActiveTableState {
  readonly guildId: string;
  readonly channelId: string;
  roundId: number;
  phase: TablePhase;
  endsAtMs: number;
  emptyRounds: number;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

export interface TableCallbacks {
  createRound: (guildId: string, channelId: string) => Promise<number> | number;
  renderBetting: (info: {
    guildId: string;
    channelId: string;
    roundId: number;
    endsAtMs: number;
  }) => Promise<void>;
  renderShaking: (info: {
    guildId: string;
    channelId: string;
    roundId: number;
  }) => Promise<void>;
  renderDieStep: (info: {
    guildId: string;
    channelId: string;
    roundId: number;
    dice: DiceRoll;
    revealedCount: 1 | 2;
  }) => Promise<void>;
  settleAndRenderResult: (info: {
    guildId: string;
    channelId: string;
    roundId: number;
    dice: DiceRoll;
  }) => Promise<{ totalBets: number }>;
  renderClosed: (info: {
    guildId: string;
    channelId: string;
    reason: 'EMPTY' | 'STOPPED';
  }) => Promise<void>;
  onError?: (err: unknown, context: { guildId: string; channelId: string }) => void;
}

export interface TableTimings {
  readonly roundDurationMs?: number;
  readonly shakeDelayMs?: number;
  readonly dieStepDelayMs?: number;
  readonly nextRoundDelayMs?: number;
  readonly maxEmptyRounds?: number;
  readonly rollDiceFn?: () => DiceRoll;
}

/**
 * Orchestrates per-channel Tai Xiu session lifecycles:
 * betting -> bowl shake -> reveal die 1 -> reveal die 2 -> reveal die 3 & settle -> next/close.
 */
export class TableManager {
  private readonly tables = new Map<string, ActiveTableState>();
  private readonly roundDurationMs: number;
  private readonly shakeDelayMs: number;
  private readonly dieStepDelayMs: number;
  private readonly nextRoundDelayMs: number;
  private readonly maxEmptyRounds: number;
  private readonly rollDiceFn: () => DiceRoll;

  constructor(
    private readonly callbacks: TableCallbacks,
    timings: TableTimings = {},
  ) {
    this.roundDurationMs = timings.roundDurationMs ?? GAME_CONFIG.ROUND_DURATION_MS;
    this.shakeDelayMs = timings.shakeDelayMs ?? GAME_CONFIG.SHAKE_DELAY_MS;
    this.dieStepDelayMs = timings.dieStepDelayMs ?? GAME_CONFIG.DIE_STEP_DELAY_MS;
    this.nextRoundDelayMs = timings.nextRoundDelayMs ?? GAME_CONFIG.NEXT_ROUND_DELAY_MS;
    this.maxEmptyRounds = timings.maxEmptyRounds ?? GAME_CONFIG.MAX_EMPTY_ROUNDS;
    this.rollDiceFn = timings.rollDiceFn ?? rollDice;
  }

  getTable(channelId: string): ActiveTableState | undefined {
    return this.tables.get(channelId);
  }

  isBettingOpen(channelId: string, roundId: number): boolean {
    const table = this.tables.get(channelId);
    return Boolean(table && !table.stopped && table.roundId === roundId && table.phase === 'BETTING');
  }

  /**
   * Starts a new table in a channel. Returns false if a table is already active there.
   */
  async startTable(guildId: string, channelId: string): Promise<boolean> {
    if (this.tables.has(channelId)) {
      return false;
    }

    const roundId = await this.callbacks.createRound(guildId, channelId);
    if (this.tables.has(channelId)) {
      return false;
    }

    const state: ActiveTableState = {
      guildId,
      channelId,
      roundId,
      phase: 'BETTING',
      endsAtMs: Date.now() + this.roundDurationMs,
      emptyRounds: 0,
      timer: null,
      stopped: false,
    };

    this.tables.set(channelId, state);
    await this.beginBettingPhase(state);
    return true;
  }

  stopTable(channelId: string): void {
    const state = this.tables.get(channelId);
    if (!state) return;
    state.stopped = true;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    this.tables.delete(channelId);
  }

  stopAll(): void {
    for (const channelId of [...this.tables.keys()]) {
      this.stopTable(channelId);
    }
  }

  private async beginBettingPhase(state: ActiveTableState): Promise<void> {
    if (state.stopped) return;
    state.phase = 'BETTING';
    state.endsAtMs = Date.now() + this.roundDurationMs;

    try {
      await this.callbacks.renderBetting({
        guildId: state.guildId,
        channelId: state.channelId,
        roundId: state.roundId,
        endsAtMs: state.endsAtMs,
      });
    } catch (err) {
      this.handleFailure(state, err);
      return;
    }

    if (state.stopped) return;
    state.timer = setTimeout(() => {
      void this.beginRevealPhase(state);
    }, this.roundDurationMs);
  }

  private async beginRevealPhase(state: ActiveTableState): Promise<void> {
    if (state.stopped) return;
    state.phase = 'REVEALING';
    const dice = this.rollDiceFn();

    try {
      await this.callbacks.renderShaking({
        guildId: state.guildId,
        channelId: state.channelId,
        roundId: state.roundId,
      });
    } catch (err) {
      this.handleFailure(state, err);
      return;
    }

    if (state.stopped) return;
    state.timer = setTimeout(() => {
      void this.revealDieStep(state, dice, 1);
    }, this.shakeDelayMs);
  }

  private async revealDieStep(
    state: ActiveTableState,
    dice: DiceRoll,
    revealedCount: 1 | 2,
  ): Promise<void> {
    if (state.stopped) return;

    try {
      await this.callbacks.renderDieStep({
        guildId: state.guildId,
        channelId: state.channelId,
        roundId: state.roundId,
        dice,
        revealedCount,
      });
    } catch (err) {
      this.handleFailure(state, err);
      return;
    }

    if (state.stopped) return;
    state.timer = setTimeout(() => {
      if (revealedCount === 1) {
        void this.revealDieStep(state, dice, 2);
      } else {
        void this.finishRound(state, dice);
      }
    }, this.dieStepDelayMs);
  }

  private async finishRound(state: ActiveTableState, dice: DiceRoll): Promise<void> {
    if (state.stopped) return;
    state.phase = 'COOLDOWN';

    let totalBets = 0;
    try {
      const settled = await this.callbacks.settleAndRenderResult({
        guildId: state.guildId,
        channelId: state.channelId,
        roundId: state.roundId,
        dice,
      });
      totalBets = settled.totalBets;
    } catch (err) {
      this.handleFailure(state, err);
      return;
    }

    if (state.stopped) return;

    if (totalBets === 0) {
      state.emptyRounds += 1;
    } else {
      state.emptyRounds = 0;
    }

    if (state.emptyRounds >= this.maxEmptyRounds) {
      this.stopTable(state.channelId);
      try {
        await this.callbacks.renderClosed({
          guildId: state.guildId,
          channelId: state.channelId,
          reason: 'EMPTY',
        });
      } catch (err) {
        this.callbacks.onError?.(err, { guildId: state.guildId, channelId: state.channelId });
      }
      return;
    }

    state.timer = setTimeout(() => {
      void this.startNextRound(state);
    }, this.nextRoundDelayMs);
  }

  private async startNextRound(state: ActiveTableState): Promise<void> {
    if (state.stopped) return;
    try {
      state.roundId = await this.callbacks.createRound(state.guildId, state.channelId);
      await this.beginBettingPhase(state);
    } catch (err) {
      this.handleFailure(state, err);
    }
  }

  private handleFailure(state: ActiveTableState, err: unknown): void {
    this.stopTable(state.channelId);
    this.callbacks.onError?.(err, { guildId: state.guildId, channelId: state.channelId });
  }
}
