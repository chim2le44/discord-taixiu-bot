import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { LixiClaimEntry, LixiPacketRecord } from '../db/repository.js';
import { getParity } from '../engine/dice.js';
import { QUEST_DEFINITIONS, type DailyQuestProgress } from '../engine/quests.js';
import {
  GAME_CONFIG,
  getBetSideLabel,
  type BetSide,
  type DiceRoll,
  type RoundHistoryItem,
  type RoundOutcome,
  type RoundSettlementResult,
  type RoundTotals,
  type UserSettlement,
} from '../engine/types.js';

export function formatCoins(amount: number): string {
  return `${amount.toLocaleString('en-US')} xu`;
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function formatHistory(items: readonly RoundHistoryItem[]): string {
  if (items.length === 0) {
    return 'Chưa có dữ liệu';
  }
  return items
    .map((item) => {
      if (item.outcome === 'TAI') return '🔴';
      if (item.outcome === 'XIU') return '🔵';
      return '🟡';
    })
    .join(' ');
}

function outcomeTitleLabel(outcome: RoundOutcome, sum: number): string {
  if (outcome === 'BAO') return `🟡 BỘ BA (${sum} điểm) - ${getParity(sum)}`;
  const side = outcome === 'TAI' ? 'TÀI' : 'XỈU';
  return `${side} - ${getParity(sum)}`;
}

function formatUserBets(u: UserSettlement): string {
  return u.bets
    .map((b) => `${getBetSideLabel(b.side)}: ${b.amount.toLocaleString('en-US')}`)
    .join(', ');
}

export function formatLoseStreakTag(loseStreak: number): string {
  if (loseStreak >= 8) return `☠️x${loseStreak}`;
  if (loseStreak >= 5) return `💀x${loseStreak}`;
  if (loseStreak >= 3) return `🤡x${loseStreak}`;
  return '';
}

/**
 * Compact 3-embed betting table matching the clean multi-card layout:
 * 1) Rules & odds + countdown
 * 2) Orange Jackpot card
 * 3) Teal live bet totals
 */
export function buildBettingEmbeds(params: {
  roundId: number;
  endsAtMs: number;
  jackpotPool: number;
  totals: RoundTotals;
  history: readonly RoundHistoryItem[];
  isGolden?: boolean;
}): EmbedBuilder[] {
  const unixSec = Math.floor(params.endsAtMs / 1000);
  const { totals } = params;
  const isGolden = params.isGolden ?? false;

  const rulesEmbed = new EmbedBuilder()
    .setColor(isGolden ? 0xfbbf24 : 0xf5c542)
    .setTitle(isGolden ? `TÀI XỈU #${params.roundId} • ⚡ GIỜ VÀNG` : `TÀI XỈU #${params.roundId}`)
    .setDescription(
      [
        ...(isGolden
          ? ['⚡ **PHIÊN GIỜ VÀNG:** Tài/Xỉu & Chẵn/Lẻ **x2.1** • Góp Hũ **x2 (10%)**', '']
          : []),
        '▎ **Tỉ lệ cược**',
        isGolden
          ? '• **Tài – Xỉu:** **x2.1** *(Giờ Vàng!)*'
          : '• **Tài – Xỉu:** x1.9',
        isGolden
          ? '• **Chẵn – Lẻ:** **x2.1** *(Giờ Vàng!)*'
          : '• **Chẵn – Lẻ:** x1.9',
        '• **Cược số:** x1.9 / x2.8 / x3.6 *(theo số viên ra)*',
        '• **Cược tổng:** 9–12: **x4.5** | 3 & 18: **x10.8** | Còn lại: **x6.2**',
        isGolden
          ? `• **Nổ hũ:** Góp Hũ **x2 (10%)**! Ra bộ ba chia cho người thắng từ **${formatCoins(GAME_CONFIG.JACKPOT_MIN_BET)}**.`
          : `• **Nổ hũ:** Ra bộ ba, Hũ chia cho người thắng cược từ **${formatCoins(GAME_CONFIG.JACKPOT_MIN_BET)}**.`,
        '',
        '▎ Hãy chọn cửa bên dưới và nhập số xu cược',
        `⏳ Kết thúc trong: <t:${unixSec}:R>`,
      ].join('\n'),
    )
    .setFooter({ text: `Cầu gần nhất: ${formatHistory(params.history)}` });

  const jackpotEmbed = new EmbedBuilder()
    .setColor(0xf97316)
    .setDescription(`💰 **Hũ Tài Xỉu:** **${formatCoins(params.jackpotPool)}**`);

  const totalsEmbed = new EmbedBuilder()
    .setColor(0x2dd4bf)
    .setTitle('TỔNG CƯỢC')
    .setDescription(
      [
        `• **Tài:** ${formatCoins(totals.taiTotal)}`,
        `• **Xỉu:** ${formatCoins(totals.xiuTotal)}`,
        `• **Chẵn:** ${formatCoins(totals.chanTotal)}`,
        `• **Lẻ:** ${formatCoins(totals.leTotal)}`,
        `• **Cược Số / Cược Tổng:** ${formatCoins(totals.extraTotal)}`,
      ].join('\n'),
    );

  return [rulesEmbed, jackpotEmbed, totalsEmbed];
}

export function buildShakingEmbed(params: {
  roundId: number;
  jackpotPool: number;
  totals: RoundTotals;
}): EmbedBuilder {
  const { totals } = params;
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`🎲 BÀN TÀI XỈU — PHIÊN #${params.roundId}`)
    .setDescription(
      [
        `🔒 **Đã khóa sổ! Đang úp tô lắc xúc xắc...**`,
        `💰 **Hũ Tài Xỉu:** ${formatCoins(params.jackpotPool)}`,
      ].join('\n'),
    )
    .addFields(
      { name: '🔴 Tài', value: formatCoins(totals.taiTotal), inline: true },
      { name: '🔵 Xỉu', value: formatCoins(totals.xiuTotal), inline: true },
      {
        name: '🎯 Chẵn/Lẻ/Số/Tổng',
        value: formatCoins(totals.chanTotal + totals.leTotal + totals.extraTotal),
        inline: true,
      },
    )
    .setImage('attachment://bowl-shake.gif');
}

export function buildDieRevealEmbed(params: {
  roundId: number;
  revealedCount: 1 | 2;
  dice: DiceRoll;
  jackpotPool: number;
}): EmbedBuilder {
  const msg =
    params.revealedCount === 1
      ? `✨ Mở viên thứ nhất: **[ ${params.dice[0]} ]** — Đang lật tiếp viên thứ hai...`
      : `🔥 Mở viên thứ hai: **[ ${params.dice[0]} ] [ ${params.dice[1]} ]** — Tạm tính **${params.dice[0] + params.dice[1]}**, hồi hộp chờ viên cuối!`;

  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`🎲 MỞ BÁT PHIÊN #${params.roundId}`)
    .setDescription(`${msg}\n💰 **Hũ Tài Xỉu:** ${formatCoins(params.jackpotPool)}`)
    .setImage('attachment://dice-step.png');
}

/**
 * Builds the 3-card stacked result view:
 * 1) Outcome + Dice image
 * 2) Orange Jackpot card
 * 3) Purple Participant win/loss list
 */
export function buildResultEmbeds(params: {
  roundId: number;
  settlement: RoundSettlementResult;
  userBalances?: ReadonlyMap<string, number>;
}): EmbedBuilder[] {
  const { settlement, userBalances } = params;
  const [d1, d2, d3] = settlement.dice;
  const mainColor =
    settlement.outcome === 'TAI'
      ? 0xef4444
      : settlement.outcome === 'XIU'
        ? 0x3b82f6
        : 0xeab308;

  const outcomeEmbed = new EmbedBuilder()
    .setColor(mainColor)
    .setTitle(
      settlement.isGolden
        ? `⚡ KẾT QUẢ TÀI XỈU #${params.roundId} — GIỜ VÀNG`
        : `KẾT QUẢ TÀI XỈU #${params.roundId}`,
    )
    .setDescription(
      [
        `➡️ Kết quả: **${d1} + ${d2} + ${d3} = ${settlement.sum}**`,
        `Chung cuộc: **${outcomeTitleLabel(settlement.outcome, settlement.sum)}**`,
      ].join('\n'),
    )
    .setImage('attachment://dice-result.png');

  const jackpotNotes: string[] = [`**${formatCoins(settlement.newJackpotPool)}**`];
  if (settlement.isBao && settlement.jackpotPaidOut > 0) {
    jackpotNotes.push(
      `💥 **NỔ HŨ BỘ BA!** Đã chia **${formatCoins(settlement.jackpotPaidOut)}** cho người thắng!`,
    );
  } else if (settlement.isBao) {
    jackpotNotes.push('🛡️ Ra bộ ba nhưng chưa có người thắng đủ điều kiện nổ hũ — Hũ được giữ nguyên.');
  }

  const jackpotEmbed = new EmbedBuilder()
    .setColor(0xf97316)
    .setTitle('HŨ TÀI XỈU')
    .setDescription(jackpotNotes.join('\n'));

  const winners = settlement.userSettlements
    .filter((u) => !u.lostRound && u.netDelta > 0)
    .sort((a, b) => b.netDelta - a.netDelta);
  const losers = settlement.userSettlements
    .filter((u) => u.lostRound)
    .sort(
      (a, b) =>
        a.payout - a.consolationBonus - a.totalBet - (b.payout - b.consolationBonus - b.totalBet),
    );
  const evens = settlement.userSettlements.filter((u) => !u.lostRound && u.netDelta === 0);

  const walletTag = (userId: string) => {
    const bal = userBalances?.get(userId);
    return bal !== undefined ? ` • Ví: ${formatCoins(bal)}` : '';
  };

  const participantsEmbed = new EmbedBuilder()
    .setColor(0xd946ef)
    .setTitle('DANH SÁCH THẮNG / THUA')
    .setFooter({ text: 'Phiên mới sẽ tự mở sau vài giây...' });

  if (settlement.userSettlements.length === 0) {
    participantsEmbed.setDescription('Không có ai đặt cược ở phiên này.');
    return [outcomeEmbed, jackpotEmbed, participantsEmbed];
  }

  if (winners.length > 0) {
    const winLines = winners.slice(0, 10).map((u) => {
      const sides = formatUserBets(u);
      const streakTag = u.newStreak >= 3 ? ` 🔥x${u.newStreak}` : '';
      const bonusTag = u.streakBonus > 0 ? ` (+chuỗi ${formatCoins(u.streakBonus)})` : '';
      const jackpotTag = u.jackpotShare > 0 ? ` (+hũ ${formatCoins(u.jackpotShare)})` : '';
      return `<@${u.userId}> | ${sides} | ✅ **+${formatCoins(u.netDelta)}** (nhận ${formatCoins(u.payout)})${jackpotTag}${streakTag}${bonusTag}${walletTag(u.userId)}`;
    });
    if (winners.length > 10) {
      winLines.push(`*...và ${winners.length - 10} người thắng khác.*`);
    }
    participantsEmbed.addFields({
      name: `🏆 THẮNG (${winners.length})`,
      value: truncateText(winLines.join('\n'), 1024),
      inline: false,
    });
  }

  if (losers.length > 0) {
    const loseLines = losers.slice(0, 10).map((u) => {
      const sides = formatUserBets(u);
      const basePayout = u.payout - u.consolationBonus;
      const roundLoss = u.totalBet - basePayout;
      const partial = basePayout > 0 ? ` (thu hồi ${formatCoins(basePayout)})` : '';
      const loseTag = formatLoseStreakTag(u.newLoseStreak);
      const loseSuffix = loseTag ? ` ${loseTag}` : '';
      const consolationSuffix =
        u.consolationBonus > 0 ? ` (+an ủi ${formatCoins(u.consolationBonus)})` : '';
      return `<@${u.userId}> | ${sides} | ❌ **-${formatCoins(roundLoss)}**${partial}${loseSuffix}${consolationSuffix}${walletTag(u.userId)}`;
    });
    if (losers.length > 10) {
      loseLines.push(`*...và ${losers.length - 10} người thua khác.*`);
    }
    participantsEmbed.addFields({
      name: `💀 THUA (${losers.length})`,
      value: truncateText(loseLines.join('\n'), 1024),
      inline: false,
    });
  }

  if (evens.length > 0) {
    const evenLines = evens.slice(0, 5).map((u) => {
      const sides = formatUserBets(u);
      return `<@${u.userId}> | ${sides} | 🤝 Hòa vốn${walletTag(u.userId)}`;
    });
    participantsEmbed.addFields({
      name: `🤝 HÒA VỐN (${evens.length})`,
      value: truncateText(evenLines.join('\n'), 1024),
      inline: false,
    });
  }

  return [outcomeEmbed, jackpotEmbed, participantsEmbed];
}

/**
 * Builds the 2 compact button rows (no sticky dropdown state):
 * - Row 1: [🔴 Tài] [🔵 Xỉu] [🔁 Cược lại] [📊 Soi cầu]
 * - Row 2: [🟢 Chẵn] [🟣 Lẻ] [🎯 Cược Số] [🎲 Cược Tổng]
 */
export function buildBetComponents(
  roundId: number,
  disabled = false,
): [ActionRowBuilder<ButtonBuilder>, ActionRowBuilder<ButtonBuilder>] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tx_bet:${roundId}:TAI`)
      .setLabel('🔴 Tài')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_bet:${roundId}:XIU`)
      .setLabel('🔵 Xỉu')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_repeat:${roundId}`)
      .setLabel('🔁 Cược lại')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_stats:${roundId}`)
      .setLabel('📊 Soi cầu')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(false),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tx_bet:${roundId}:CHAN`)
      .setLabel('🟢 Chẵn')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_bet:${roundId}:LE`)
      .setLabel('🟣 Lẻ')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_pick:${roundId}:SO`)
      .setLabel('🎯 Cược Số')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_pick:${roundId}:TONG`)
      .setLabel('🎲 Cược Tổng')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );

  return [row1, row2];
}

/**
 * Builds a 2-field modal for Cược Số (1-6) or Cược Tổng (3-18) so users type
 * the exact target number instead of scrolling a long dropdown list.
 */
export function buildNumberOrSumBetModal(
  roundId: number,
  kind: 'SO' | 'TONG',
  balance: number,
): ModalBuilder {
  const targetInput = new TextInputBuilder()
    .setCustomId('bet_target')
    .setLabel(kind === 'SO' ? 'Chọn số (1 đến 6)' : 'Chọn tổng (3 đến 18)')
    .setPlaceholder(
      kind === 'SO'
        ? 'Nhập 1 số từ 1 đến 6 (VD: 5)'
        : 'Nhập tổng từ 3 đến 18 (VD: 11)',
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(2);

  const amountInput = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel('Số xu muốn cược')
    .setPlaceholder(
      truncateText(`Có: ${formatCoins(balance)} • VD: 500, 10k, 50%, all`, 100),
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const title =
    kind === 'SO' ? `Cược Số (1-6) — #${roundId}` : `Cược Tổng (3-18) — #${roundId}`;

  return new ModalBuilder()
    .setCustomId(`tx_modal_pick:${roundId}:${kind}`)
    .setTitle(truncateText(title, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(targetInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput),
    );
}

/**
 * Builds the bet-amount modal with strict Discord length limits:
 * - Title <= 45 chars
 * - TextInput label fixed <= 45 chars (never embeds dynamic balance!)
 * - Placeholder <= 100 chars
 */
export function buildBetModal(roundId: number, side: BetSide, balance: number): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId('bet_amount')
    .setLabel('Số xu muốn cược')
    .setPlaceholder(
      truncateText(`Có: ${formatCoins(balance)} • VD: 500, 10k, 50%, all`, 100),
    )
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  return new ModalBuilder()
    .setCustomId(`tx_modal:${roundId}:${side}`)
    .setTitle(truncateText(`Đặt ${getBetSideLabel(side)} — Phiên #${roundId}`, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export function buildLixiEmbed(
  packet: LixiPacketRecord,
  claims: readonly LixiClaimEntry[],
): EmbedBuilder {
  const isOpen = packet.status === 'OPEN';
  const unixExpire = Math.floor(packet.expiresAt / 1000);
  const statusLine =
    packet.status === 'OPEN'
      ? `⏳ Hết hạn: <t:${unixExpire}:R> (còn **${packet.remainingSlots}/${packet.totalSlots}** suất)`
      : packet.status === 'COMPLETED'
        ? '🎊 **Đã phát hết toàn bộ bao lì xì!**'
        : '⌛ **Bao lì xì đã hết hạn** (xu dư đã hoàn cho chủ xị).';

  const claimLines =
    claims.length > 0
      ? claims
          .slice(0, 15)
          .map((c, idx) => `${idx + 1}. <@${c.userId}> giật được **+${formatCoins(c.amount)}**`)
          .join('\n')
      : 'Chưa có ai giật lì xì...';

  return new EmbedBuilder()
    .setColor(isOpen ? 0xef4444 : 0x6b7280)
    .setTitle(`🧧 BAO LÌ XÌ MAY MẮN #${packet.id}`)
    .setDescription(
      [
        `👤 Chủ xị: <@${packet.creatorId}>`,
        `💰 Tổng quỹ: **${formatCoins(packet.totalAmount)}** (${packet.totalSlots} suất ngẫu nhiên)`,
        statusLine,
      ].join('\n'),
    )
    .addFields({
      name: `Danh sách đã nhận (${claims.length}/${packet.totalSlots})`,
      value: claimLines,
    });
}

export function buildLixiButtons(packetId: number, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tx_lixi:${packetId}`)
      .setLabel('🧧 Giật lì xì')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

export function buildQuestsEmbed(
  progress: DailyQuestProgress,
  balance: number,
): { embed: EmbedBuilder; hasClaimable: boolean } {
  let hasClaimable = false;

  const lines = QUEST_DEFINITIONS.map((def) => {
    const rawVal = progress[def.field];
    const clamped = Math.min(rawVal, def.target);
    const claimed = progress[def.claimedField];
    const ready = !claimed && rawVal >= def.target;
    if (ready) hasClaimable = true;

    const status = claimed
      ? '✅ Đã nhận'
      : ready
        ? '🎁 **Sẵn sàng nhận!**'
        : '⏳ Đang thực hiện';

    return `• **${def.label}** (${clamped.toLocaleString('en-US')}/${def.target.toLocaleString('en-US')})\n  Phần thưởng: **+${formatCoins(def.reward)}** — ${status}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0x10b981)
    .setTitle(`📋 NHIỆM VỤ HẰNG NGÀY (${progress.dateKey})`)
    .setDescription(lines.join('\n\n'))
    .setFooter({
      text: `Số dư hiện tại: ${formatCoins(balance)} • Reset lúc 00:00 mỗi ngày (giờ VN)`,
    });

  return { embed, hasClaimable };
}

export function buildQuestsButtons(
  hasClaimable: boolean,
  ownerId?: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ownerId ? `tx_quest_claim:${ownerId}` : 'tx_quest_claim')
      .setLabel('🎁 Nhận thưởng')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!hasClaimable),
  );
}

export function buildSoloChallengeEmbed(params: {
  challengerId: string;
  opponentId: string;
  amount: number;
  expiresAtMs: number;
}): EmbedBuilder {
  const unix = Math.floor(params.expiresAtMs / 1000);
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle('⚔️ THÁCH ĐẤU TÀI XỈU 1v1')
    .setDescription(
      [
        `<@${params.challengerId}> thách đấu <@${params.opponentId}>`,
        `💵 Mức cược: **${formatCoins(params.amount)}** (người thắng ăn trọn **+${formatCoins(params.amount)}** từ đối thủ)`,
        `🎲 Luật: Mỗi người tung 3 xúc xắc, tổng điểm cao hơn thắng (hòa hoàn tiền).`,
        `⏳ Hết hạn: <t:${unix}:R>`,
      ].join('\n'),
    );
}

export function buildSoloChallengeButtons(
  challengeId: string,
  disabled: boolean,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tx_solo_accept:${challengeId}`)
      .setLabel('⚔️ Chấp nhận')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`tx_solo_decline:${challengeId}`)
      .setLabel('❌ Từ chối')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

export function buildSoloResultEmbed(params: {
  challengerId: string;
  opponentId: string;
  amount: number;
  winnerId: string | null;
  challengerSum: number;
  opponentSum: number;
}): EmbedBuilder {
  const summary = params.winnerId
    ? `🏆 <@${params.winnerId}> giành chiến thắng và nhận **+${formatCoins(params.amount)}**!`
    : `🤝 **HÒA!** Cả hai cùng **${params.challengerSum} điểm** — Không ai mất xu.`;

  return new EmbedBuilder()
    .setColor(params.winnerId ? 0x10b981 : 0x6b7280)
    .setTitle('⚔️ KẾT QUẢ SOLO 1v1')
    .setDescription(
      [
        `<@${params.challengerId}> (**${params.challengerSum} điểm**) vs <@${params.opponentId}> (**${params.opponentSum} điểm**)`,
        summary,
      ].join('\n'),
    )
    .setImage('attachment://solo-result.png');
}
