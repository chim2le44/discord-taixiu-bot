import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TableManager } from '../src/engine/tableManager.js';

describe('TableManager lifecycle with step-by-step reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs betting -> shaking -> die 1 -> die 2 -> settle -> auto-close after 2 empty rounds', async () => {
    let nextId = 1;
    const events: string[] = [];

    const manager = new TableManager(
      {
        createRound: () => nextId++,
        renderBetting: async ({ roundId }) => {
          events.push(`betting:${roundId}`);
        },
        renderShaking: async ({ roundId }) => {
          events.push(`shake:${roundId}`);
        },
        renderDieStep: async ({ roundId, dice, revealedCount }) => {
          events.push(`die${revealedCount}:${roundId}:${dice.slice(0, revealedCount).join('-')}`);
        },
        settleAndRenderResult: async ({ roundId, dice }) => {
          events.push(`settle:${roundId}:${dice.join('-')}`);
          return { totalBets: 0 };
        },
        renderClosed: async ({ reason }) => {
          events.push(`closed:${reason}`);
        },
      },
      {
        roundDurationMs: 1_000,
        shakeDelayMs: 400,
        dieStepDelayMs: 300,
        nextRoundDelayMs: 500,
        maxEmptyRounds: 2,
        rollDiceFn: () => [5, 3, 3],
      },
    );

    expect(await manager.startTable('g1', 'c1')).toBe(true);
    expect(await manager.startTable('g1', 'c1')).toBe(false);
    expect(manager.isBettingOpen('c1', 1)).toBe(true);

    // Round 1: betting (1000) -> shake (400) -> die1 (300) -> die2 (300) -> settle
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.isBettingOpen('c1', 1)).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);

    // Cooldown before round 2
    await vi.advanceTimersByTimeAsync(500);

    // Round 2
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(400);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);

    expect(manager.getTable('c1')).toBeUndefined();
    expect(events).toEqual([
      'betting:1',
      'shake:1',
      'die1:1:5',
      'die2:1:5-3',
      'settle:1:5-3-3',
      'betting:2',
      'shake:2',
      'die1:2:5',
      'die2:2:5-3',
      'settle:2:5-3-3',
      'closed:EMPTY',
    ]);
  });
});
