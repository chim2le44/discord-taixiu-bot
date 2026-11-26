import { describe, expect, it } from 'vitest';
import {
  buildBetComponents,
  buildBetModal,
  buildBettingEmbeds,
  buildNumberOrSumBetModal,
  buildQuestsButtons,
  buildResultEmbeds,
} from '../src/discord/embeds.js';
import { settleRound } from '../src/engine/settlement.js';
import { ALL_BET_SIDES } from '../src/engine/types.js';

describe('Discord embeds, components, and modal safety', () => {
  it('buildBetModal and buildNumberOrSumBetModal never exceed Discord 45-char limits', () => {
    for (const side of ALL_BET_SIDES) {
      const modal = buildBetModal(999_999_999, side, 999_999_999_999);
      const json = modal.toJSON();
      expect(json.title.length).toBeLessThanOrEqual(45);
      const input = json.components[0].components[0];
      expect(input.label.length).toBeLessThanOrEqual(45);
      expect(input.placeholder?.length ?? 0).toBeLessThanOrEqual(100);
    }

    for (const kind of ['SO', 'TONG'] as const) {
      const pickModal = buildNumberOrSumBetModal(999_999_999, kind, Number.MAX_SAFE_INTEGER);
      const json = pickModal.toJSON();
      expect(json.title.length).toBeLessThanOrEqual(45);
      for (const row of json.components) {
        const inp = row.components[0];
        expect(inp.label.length).toBeLessThanOrEqual(45);
        expect(inp.placeholder?.length ?? 0).toBeLessThanOrEqual(100);
      }
    }
  });

  it('buildBetComponents has 2 button rows with 4 buttons each (no sticky dropdown)', () => {
    const [row1, row2] = buildBetComponents(77210, false);
    const row1Json = row1.toJSON();
    const row2Json = row2.toJSON();

    expect(row1Json.components).toHaveLength(4);
    expect(row1Json.components.map((c) => ('custom_id' in c ? c.custom_id : ''))).toEqual([
      'tx_bet:77210:TAI',
      'tx_bet:77210:XIU',
      'tx_repeat:77210',
      'tx_stats:77210',
    ]);

    expect(row2Json.components).toHaveLength(4);
    expect(row2Json.components.map((c) => ('custom_id' in c ? c.custom_id : ''))).toEqual([
      'tx_bet:77210:CHAN',
      'tx_bet:77210:LE',
      'tx_pick:77210:SO',
      'tx_pick:77210:TONG',
    ]);
  });

  it('buildBettingEmbeds produces 3 compact stacked embeds', () => {
    const embeds = buildBettingEmbeds({
      roundId: 77210,
      endsAtMs: Date.now() + 30_000,
      jackpotPool: 35_869_149,
      totals: {
        taiTotal: 1_000,
        xiuTotal: 2_000,
        chanTotal: 500,
        leTotal: 0,
        extraTotal: 300,
        totalBetCount: 4,
      },
      history: [],
    });

    expect(embeds).toHaveLength(3);
    expect(embeds[0].toJSON().title).toBe('TÀI XỈU #77210');
    expect(embeds[1].toJSON().description).toContain('35,869,149 xu');
    expect(embeds[2].toJSON().title).toBe('TỔNG CƯỢC');
  });

  it('buildResultEmbeds separates winners and losers with exact coin deltas and wallet balances', () => {
    const settlement = settleRound({
      dice: [5, 3, 3], // 11 -> TAI
      bets: [
        { userId: 'u1', side: 'TAI', amount: 1_000 },
        { userId: 'u2', side: 'XIU', amount: 2_000 },
      ],
      currentJackpot: 10_000,
      userStreaks: new Map(),
    });

    const embeds = buildResultEmbeds({
      roundId: 77210,
      settlement,
      userBalances: new Map([
        ['u1', 10_900],
        ['u2', 8_000],
      ]),
    });

    const participants = embeds[2].toJSON();
    expect(participants.title).toBe('DANH SÁCH THẮNG / THUA');
    expect(participants.fields).toHaveLength(2);
    expect(participants.fields?.[0].name).toBe('🏆 THẮNG (1)');
    expect(participants.fields?.[0].value).toContain('+900 xu');
    expect(participants.fields?.[0].value).toContain('10,900 xu');
    expect(participants.fields?.[1].name).toBe('💀 THUA (1)');
    expect(participants.fields?.[1].value).toContain('-2,000 xu');
    expect(participants.fields?.[1].value).toContain('8,000 xu');
  });

  it('renders Golden Round embeds, keeps Thánh Đen losers in 💀 THUA even with large consolation, and scopes quest button', () => {
    const betting = buildBettingEmbeds({
      roundId: 88,
      endsAtMs: Date.now() + 30_000,
      jackpotPool: 50_000,
      totals: {
        taiTotal: 0,
        xiuTotal: 0,
        chanTotal: 0,
        leTotal: 0,
        extraTotal: 0,
        totalBetCount: 0,
      },
      history: [],
      isGolden: true,
    });
    expect(betting[0].toJSON().title).toBe('TÀI XỈU #88 • ⚡ GIỜ VÀNG');
    expect(betting[0].toJSON().description).toContain('PHIÊN GIỜ VÀNG');
    expect(betting[0].toJSON().description).toContain('x2.1');

    const settlement = settleRound({
      dice: [1, 2, 3], // XIU
      bets: [{ userId: 'u1', side: 'TAI', amount: 1_000 }],
      currentJackpot: 0,
      userStreaks: new Map(),
      isGolden: true,
      userLoseStreaks: new Map([['u1', { streak: 4, loss: 20_000 }]]),
    });

    const results = buildResultEmbeds({
      roundId: 88,
      settlement,
      userBalances: new Map([['u1', 12_150]]),
    });
    expect(results[0].toJSON().title).toBe('⚡ KẾT QUẢ TÀI XỈU #88 — GIỜ VÀNG');
    const participants = results[2].toJSON();
    expect(participants.fields).toHaveLength(1);
    expect(participants.fields?.[0].name).toBe('💀 THUA (1)');
    expect(participants.fields?.[0].value).toContain('-1,000 xu');
    expect(participants.fields?.[0].value).toContain('💀x5 (+an ủi 3,150 xu)');

    const questBtn = buildQuestsButtons(true, 'u1').toJSON().components[0];
    expect('custom_id' in questBtn ? questBtn.custom_id : '').toBe('tx_quest_claim:u1');
  });
});
