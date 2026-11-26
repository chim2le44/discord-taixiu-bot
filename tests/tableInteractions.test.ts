import type { AttachmentBuilder, ButtonInteraction, Client, Message } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import {
  createTableManager,
  handleButtonInteraction,
  type BotContext,
} from '../src/discord/interactions.js';
import { GAME_CONFIG } from '../src/engine/types.js';

interface RecordedMessage {
  sendPayload: unknown;
  editCalls: Array<Record<string, unknown>>;
  deleteMock: ReturnType<typeof vi.fn>;
  msg: Message;
}

describe('Table Discord message lifecycle', () => {
  let db: DatabaseSync;
  let repo: Repository;
  let ctx: BotContext;

  beforeEach(() => {
    vi.useFakeTimers();
    db = openDatabase(':memory:');
    repo = new Repository(db);
  });

  afterEach(() => {
    ctx?.tableManager.stopAll();
    for (const timer of ctx?.pendingEditTimers.values() ?? []) {
      clearTimeout(timer);
    }
    db.close();
    vi.useRealTimers();
  });

  it('deletes old betting frame on new round, inlines Golden info, keeps results, and supports tx_pick buttons', async () => {
    const sentMessages: RecordedMessage[] = [];
    const sendMock = vi.fn(async (payload: unknown) => {
      const editCalls: Array<Record<string, unknown>> = [];
      const editMock = vi.fn(async (editPayload: Record<string, unknown>) => {
        editCalls.push(editPayload);
        return msg;
      });
      const deleteMock = vi.fn(async () => undefined);
      const msg = {
        id: `msg-${sentMessages.length + 1}`,
        edit: editMock,
        delete: deleteMock,
      } as unknown as Message;
      sentMessages.push({ sendPayload: payload, editCalls, deleteMock, msg });
      return msg;
    });

    const fakeChannel = {
      isTextBased: () => true,
      isDMBased: () => false,
      send: sendMock,
    };

    const fakeClient = {
      channels: {
        fetch: vi.fn(async () => fakeChannel),
      },
    } as unknown as Client;

    const tableManager = createTableManager(() => ctx, repo);
    ctx = {
      client: fakeClient,
      repo,
      tableManager,
      tableMessages: new Map(),
      bettingMessages: new Map(),
      lastEditAt: new Map(),
      pendingEditTimers: new Map(),
      lixiTimers: new Map(),
      soloChallenges: new Map(),
    };

    expect(await tableManager.startTable('g1', 'c1')).toBe(true);

    // Clicking tx_pick:SO and tx_pick:TONG opens modals cleanly and repeatedly
    const r1Id = tableManager.getTable('c1')!.roundId;
    const showModalMock = vi.fn(async () => undefined);
    for (const kind of ['SO', 'SO', 'TONG'] as const) {
      await handleButtonInteraction(
        {
          guildId: 'g1',
          channelId: 'c1',
          user: { id: 'u1' },
          customId: `tx_pick:${r1Id}:${kind}`,
          showModal: showModalMock,
        } as unknown as ButtonInteraction,
        ctx,
      );
    }
    expect(showModalMock).toHaveBeenCalledTimes(3);

    // Round 1: betting -> shake -> die 1 -> die 2 -> result
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.SHAKE_DELAY_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.DIE_STEP_DELAY_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.DIE_STEP_DELAY_MS);

    // Cooldown -> Round 2 betting (deletes Round 1 betting message, keeps Round 1 result)
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.NEXT_ROUND_DELAY_MS);

    // Round 2: betting -> shake -> die 1 -> die 2 -> result -> auto-close
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.ROUND_DURATION_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.SHAKE_DELAY_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.DIE_STEP_DELAY_MS);
    await vi.advanceTimersByTimeAsync(GAME_CONFIG.DIE_STEP_DELAY_MS);

    // 1) Round 1 bet, Round 1 reveal, Round 2 bet, Round 2 reveal, Closed notice
    expect(sendMock).toHaveBeenCalledTimes(5);

    // 2) Round 1 betting message never sends external content above embed, disabled once on shake, then deleted on Round 2
    const r1Bet = sentMessages[0];
    expect((r1Bet.sendPayload as { content?: string }).content).toBeUndefined();
    expect(r1Bet.editCalls).toHaveLength(1);
    expect(Object.keys(r1Bet.editCalls[0])).toEqual(['components']);
    expect(r1Bet.deleteMock).toHaveBeenCalledTimes(1);

    // 3) Round 1 reveal/result message is never deleted and holds dice-result.png
    const r1Reveal = sentMessages[1];
    expect(r1Reveal.deleteMock).not.toHaveBeenCalled();
    expect(r1Reveal.editCalls).toHaveLength(3);
    expect((r1Reveal.editCalls[2].files as AttachmentBuilder[]).map((f) => f.name)).toEqual([
      'dice-result.png',
    ]);

    // 4) Round 2 betting message has no external content above embed; Round 2 result is kept on close
    const r2Bet = sentMessages[2];
    expect((r2Bet.sendPayload as { content?: string }).content).toBeUndefined();
    expect(sentMessages[3].deleteMock).not.toHaveBeenCalled();
    expect(typeof sentMessages[4].sendPayload).toBe('string');
  });
});
