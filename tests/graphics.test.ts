import { describe, expect, it } from 'vitest';
import {
  getBowlShakeGif,
  renderDiceRevealPng,
  renderSoloComparisonPng,
} from '../src/graphics/diceVisuals.js';
import { renderStatsChartPng } from '../src/graphics/statsChart.js';
import type { RoundHistoryItem } from '../src/engine/types.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('Graphics renderers', () => {
  it('renders valid PNG for empty and 20-round history stats chart', () => {
    const emptyBuf = renderStatsChartPng([]);
    expect(emptyBuf.subarray(0, 8)).toEqual(PNG_SIG);

    const sampleHistory: RoundHistoryItem[] = Array.from({ length: 20 }, (_, i) => {
      if (i === 10) return { roundId: i + 1, d1: 3, d2: 3, d3: 3, outcome: 'BAO' };
      if (i % 2 === 0) return { roundId: i + 1, d1: 5, d2: 4, d3: 3, outcome: 'TAI' };
      return { roundId: i + 1, d1: 1, d2: 3, d3: 4, outcome: 'XIU' };
    });

    const chartBuf = renderStatsChartPng(sampleHistory);
    expect(chartBuf.subarray(0, 8)).toEqual(PNG_SIG);
    expect(chartBuf.length).toBeGreaterThan(5_000);
  });

  it('renders valid PNGs for step 1, step 2, final dice reveal, and solo comparison', () => {
    for (const step of [1, 2, 3] as const) {
      const buf = renderDiceRevealPng({ dice: [5, 3, 3], revealedCount: step, roundId: 42 });
      expect(buf.subarray(0, 8)).toEqual(PNG_SIG);
    }

    const soloBuf = renderSoloComparisonPng({
      challengerName: 'Minh',
      challengerDice: [6, 5, 4],
      opponentName: 'Huy',
      opponentDice: [2, 3, 1],
    });
    expect(soloBuf.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('generates and caches a valid GIF89a for bowl shaking animation', () => {
    const gif1 = getBowlShakeGif();
    const gif2 = getBowlShakeGif();
    expect(gif1.subarray(0, 6).toString('ascii')).toBe('GIF89a');
    expect(gif1.length).toBeGreaterThan(1_000);
    expect(gif1).toBe(gif2);
  });
});
