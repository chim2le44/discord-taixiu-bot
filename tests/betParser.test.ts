import { describe, expect, it } from 'vitest';
import { parseBetAmount } from '../src/engine/betParser.js';

describe('parseBetAmount', () => {
  it('parses plain integers, commas, underscores, and spaces', () => {
    expect(parseBetAmount('500', 10_000)).toEqual({ ok: true, amount: 500 });
    expect(parseBetAmount(' 1,500 ', 10_000)).toEqual({ ok: true, amount: 1_500 });
    expect(parseBetAmount('2_000', 10_000)).toEqual({ ok: true, amount: 2_000 });
  });

  it('parses k and m suffixes including decimals', () => {
    expect(parseBetAmount('2.5k', 10_000)).toEqual({ ok: true, amount: 2_500 });
    expect(parseBetAmount('1.5M', 5_000_000)).toEqual({ ok: true, amount: 1_500_000 });
  });

  it('parses percentages and all/allin/max keywords', () => {
    expect(parseBetAmount('50%', 10_000)).toEqual({ ok: true, amount: 5_000 });
    expect(parseBetAmount('all', 10_000)).toEqual({ ok: true, amount: 10_000 });
    expect(parseBetAmount('ALLIN', 10_000)).toEqual({ ok: true, amount: 10_000 });
    expect(parseBetAmount('max', 10_000)).toEqual({ ok: true, amount: 10_000 });
  });

  it('rejects invalid formats, out-of-range percentages, zero, negative, below minBet, and over balance', () => {
    expect(parseBetAmount('', 10_000).ok).toBe(false);
    expect(parseBetAmount('0', 10_000).ok).toBe(false);
    expect(parseBetAmount('-100', 10_000).ok).toBe(false);
    expect(parseBetAmount('abc', 10_000).ok).toBe(false);
    expect(parseBetAmount('101%', 10_000).ok).toBe(false);
    expect(parseBetAmount('0%', 10_000).ok).toBe(false);
    expect(parseBetAmount('50', 10_000).ok).toBe(false);
    expect(parseBetAmount('all', 50).ok).toBe(false);
    expect(parseBetAmount('15k', 10_000).ok).toBe(false);
  });
});
