import { GAME_CONFIG } from './types.js';

export type ParseBetResult =
  | { readonly ok: true; readonly amount: number }
  | { readonly ok: false; readonly error: string };

/**
 * Parse human-friendly bet strings such as "500", "10k", "2.5m", "50%", or "all"
 * against the user's available balance and minimum bet constraint.
 */
export function parseBetAmount(
  raw: string,
  balance: number,
  minBet: number = GAME_CONFIG.MIN_BET,
): ParseBetResult {
  const normalized = raw.trim().toLowerCase().replace(/[\s,_]+/g, '');
  if (!normalized) {
    return { ok: false, error: 'Vui lòng nhập số xu muốn cược.' };
  }

  let amount: number;

  if (normalized === 'all' || normalized === 'allin' || normalized === 'max') {
    amount = Math.floor(balance);
  } else if (normalized.endsWith('%')) {
    const pctStr = normalized.slice(0, -1);
    if (!/^\d+(\.\d+)?$/.test(pctStr)) {
      return { ok: false, error: 'Phần trăm cược không hợp lệ (ví dụ: 50%).' };
    }
    const pct = Number(pctStr);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      return { ok: false, error: 'Phần trăm cược phải nằm trong khoảng 1% - 100%.' };
    }
    amount = Math.floor((balance * pct) / 100);
  } else {
    const match = /^(\d+(?:\.\d+)?)([km])?$/.exec(normalized);
    if (!match) {
      return {
        ok: false,
        error: 'Số xu không hợp lệ. Ví dụ hợp lệ: `500`, `10k`, `1.5m`, `50%`, `all`.',
      };
    }
    const base = Number(match[1]);
    const suffix = match[2];
    const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
    amount = Math.floor(base * multiplier);
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'Số xu cược phải lớn hơn 0.' };
  }
  if (amount > balance) {
    return {
      ok: false,
      error: `Số dư không đủ (bạn đang có ${balance.toLocaleString('en-US')} xu).`,
    };
  }
  if (amount < minBet) {
    return {
      ok: false,
      error: `Mức cược tối thiểu là ${minBet.toLocaleString('en-US')} xu.`,
    };
  }

  return { ok: true, amount };
}
