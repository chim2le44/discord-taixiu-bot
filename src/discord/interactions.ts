import {
  AttachmentBuilder,
  MessageFlags,
  type ActionRowBuilder,
  type ButtonBuilder,
  type ButtonInteraction,
  type Client,
  type EmbedBuilder,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { Repository } from '../db/repository.js';
import { parseBetAmount } from '../engine/betParser.js';
import { rollDice, rollIsGolden } from '../engine/dice.js';
import { TableManager } from '../engine/tableManager.js';
import { getBetSideLabel, isBetSide, type BetSide, type RoundHistoryItem } from '../engine/types.js';
import {
  getBowlShakeGif,
  renderDiceRevealPng,
  renderSoloComparisonPng,
} from '../graphics/diceVisuals.js';
import { renderStatsChartPng } from '../graphics/statsChart.js';
import {
  buildBetComponents,
  buildBetModal,
  buildBettingEmbeds,
  buildDieRevealEmbed,
  buildLixiButtons,
  buildLixiEmbed,
  buildNumberOrSumBetModal,
  buildQuestsButtons,
  buildQuestsEmbed,
  buildResultEmbeds,
  buildShakingEmbed,
  buildSoloChallengeButtons,
  buildSoloResultEmbed,
  formatCoins,
} from './embeds.js';

const EDIT_THROTTLE_MS = 1_500;

export interface SoloChallenge {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly challengerId: string;
  readonly opponentId: string;
  readonly amount: number;
  readonly timer: ReturnType<typeof setTimeout>;
  message: Message | null;
  settled: boolean;
}

export interface BotContext {
  readonly client: Client;
  readonly repo: Repository;
  readonly tableManager: TableManager;
  readonly tableMessages: Map<string, Message>;
  readonly bettingMessages: Map<string, Message>;
  readonly lastEditAt: Map<string, number>;
  readonly pendingEditTimers: Map<string, ReturnType<typeof setTimeout>>;
  readonly lixiTimers: Map<number, ReturnType<typeof setTimeout>>;
  readonly soloChallenges: Map<string, SoloChallenge>;
}

type TableActionRow = ActionRowBuilder<ButtonBuilder>;

const statsChartCache = new Map<string, { key: string; png: Buffer }>();

/**
 * Caches the rendered 20-round chart PNG per guild until a new round settles,
 * avoiding redundant synchronous canvas renders when multiple players view stats.
 */
export function getCachedStatsChartPng(
  guildId: string,
  history: readonly RoundHistoryItem[],
): Buffer {
  const latestRoundId = history[history.length - 1]?.roundId ?? 0;
  const cacheKey = `${history.length}:${latestRoundId}`;
  const cached = statsChartCache.get(guildId);
  if (cached && cached.key === cacheKey) {
    return cached.png;
  }

  const png = renderStatsChartPng(history);
  statsChartCache.set(guildId, { key: cacheKey, png });
  return png;
}

interface TableMessagePayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: TableActionRow[];
  files?: AttachmentBuilder[];
  attachments?: [];
}

function clearPendingEdit(ctx: BotContext, channelId: string): void {
  const timer = ctx.pendingEditTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    ctx.pendingEditTimers.delete(channelId);
  }
}

async function sendTableMessage(
  ctx: BotContext,
  channelId: string,
  payload: TableMessagePayload,
): Promise<Message | null> {
  clearPendingEdit(ctx, channelId);
  const channel = await ctx.client.channels.fetch(channelId);
  if (channel && channel.isTextBased() && !channel.isDMBased() && 'send' in channel) {
    const sent = await channel.send({
      content: payload.content,
      embeds: payload.embeds,
      components: payload.components,
      files: payload.files,
    });
    ctx.tableMessages.set(channelId, sent);
    ctx.lastEditAt.set(channelId, Date.now());
    return sent;
  }
  return null;
}

async function upsertTableMessage(
  ctx: BotContext,
  channelId: string,
  payload: TableMessagePayload,
): Promise<void> {
  clearPendingEdit(ctx, channelId);
  const existing = ctx.tableMessages.get(channelId);
  if (existing) {
    try {
      await existing.edit(payload);
      ctx.lastEditAt.set(channelId, Date.now());
      return;
    } catch {
      ctx.tableMessages.delete(channelId);
    }
  }

  await sendTableMessage(ctx, channelId, payload);
}

/**
 * Throttles live bet-total embed refreshes during active betting so bursts of
 * concurrent clicks stay well under Discord's message edit rate limit.
 */
export function scheduleBettingRefresh(ctx: BotContext, channelId: string): void {
  const state = ctx.tableManager.getTable(channelId);
  if (!state || state.phase !== 'BETTING') return;

  const renderNow = async () => {
    const current = ctx.tableManager.getTable(channelId);
    if (!current || current.phase !== 'BETTING') return;
    const msg = ctx.tableMessages.get(channelId);
    if (!msg) return;

    const settings = ctx.repo.getGuildSettings(current.guildId);
    const totals = ctx.repo.getRoundTotals(current.roundId);
    const history = ctx.repo.getRecentHistory(current.guildId, 15);
    const isGolden = ctx.repo.isRoundGolden(current.roundId);
    const embeds = buildBettingEmbeds({
      roundId: current.roundId,
      endsAtMs: current.endsAtMs,
      jackpotPool: settings.jackpotPool,
      totals,
      history,
      isGolden,
    });

    try {
      await msg.edit({
        embeds,
        components: buildBetComponents(current.roundId, false),
      });
      ctx.lastEditAt.set(channelId, Date.now());
    } catch {
      // Ignore transient edit failures; next phase update will recover.
    }
  };

  const now = Date.now();
  const last = ctx.lastEditAt.get(channelId) ?? 0;
  const elapsed = now - last;

  if (elapsed >= EDIT_THROTTLE_MS) {
    clearPendingEdit(ctx, channelId);
    void renderNow();
    return;
  }

  if (!ctx.pendingEditTimers.has(channelId)) {
    const delay = EDIT_THROTTLE_MS - elapsed;
    const timer = setTimeout(() => {
      ctx.pendingEditTimers.delete(channelId);
      void renderNow();
    }, delay);
    ctx.pendingEditTimers.set(channelId, timer);
  }
}

export function scheduleLixiExpiration(
  ctx: BotContext,
  packetId: number,
  expiresAtMs: number,
): void {
  const delay = Math.max(1_000, expiresAtMs - Date.now());
  const timer = setTimeout(async () => {
    ctx.lixiTimers.delete(packetId);
    const expired = ctx.repo.expireLixiPackets(Date.now(), packetId);
    if (expired.expiredCount === 0) return;

    const data = ctx.repo.getLixiPacketWithClaims(packetId);
    if (!data || !data.packet.messageId) return;

    try {
      const channel = await ctx.client.channels.fetch(data.packet.channelId);
      if (channel && channel.isTextBased() && !channel.isDMBased()) {
        const msg = await channel.messages.fetch(data.packet.messageId);
        await msg.edit({
          embeds: [buildLixiEmbed(data.packet, data.claims)],
          components: [buildLixiButtons(packetId, true)],
        });
      }
    } catch {
      // Ignore message cleanup failures if message/channel was deleted.
    }
  }, delay);

  ctx.lixiTimers.set(packetId, timer);
}

export function createTableManager(
  getContext: () => BotContext,
  repo: Repository,
): TableManager {
  return new TableManager({
    createRound: (guildId, channelId) => repo.createRound(guildId, channelId, rollIsGolden()),
    renderBetting: async ({ guildId, channelId, roundId, endsAtMs }) => {
      const ctx = getContext();
      const prevBettingMsg = ctx.bettingMessages.get(channelId);
      if (prevBettingMsg) {
        ctx.bettingMessages.delete(channelId);
        await prevBettingMsg.delete().catch(() => {
          // Ignore if already deleted.
        });
      }

      const settings = repo.getGuildSettings(guildId);
      const totals = repo.getRoundTotals(roundId);
      const history = repo.getRecentHistory(guildId, 15);
      const isGolden = repo.isRoundGolden(roundId);
      const sent = await sendTableMessage(ctx, channelId, {
        embeds: buildBettingEmbeds({
          roundId,
          endsAtMs,
          jackpotPool: settings.jackpotPool,
          totals,
          history,
          isGolden,
        }),
        components: buildBetComponents(roundId, false),
      });
      if (sent) {
        ctx.bettingMessages.set(channelId, sent);
      }
    },
    renderShaking: async ({ guildId, channelId, roundId }) => {
      const ctx = getContext();
      clearPendingEdit(ctx, channelId);
      const bettingMsg = ctx.tableMessages.get(channelId);
      ctx.tableMessages.delete(channelId);
      if (bettingMsg) {
        await bettingMsg.edit({ components: buildBetComponents(roundId, true) }).catch(() => {
          // Ignore if the betting message was deleted.
        });
      }

      const settings = repo.getGuildSettings(guildId);
      const totals = repo.getRoundTotals(roundId);
      const gif = getBowlShakeGif();
      await sendTableMessage(ctx, channelId, {
        embeds: [
          buildShakingEmbed({
            roundId,
            jackpotPool: settings.jackpotPool,
            totals,
          }),
        ],
        components: [],
        files: [new AttachmentBuilder(gif, { name: 'bowl-shake.gif' })],
      });
    },
    renderDieStep: async ({ guildId, channelId, roundId, dice, revealedCount }) => {
      const ctx = getContext();
      const settings = repo.getGuildSettings(guildId);
      const png = renderDiceRevealPng({ dice, revealedCount, roundId });
      await upsertTableMessage(ctx, channelId, {
        embeds: [
          buildDieRevealEmbed({
            roundId,
            revealedCount,
            dice,
            jackpotPool: settings.jackpotPool,
          }),
        ],
        components: [],
        files: [new AttachmentBuilder(png, { name: 'dice-step.png' })],
        attachments: [],
      });
    },
    settleAndRenderResult: async ({ guildId, channelId, roundId, dice }) => {
      const ctx = getContext();
      const { settlement, totalBets, userBalances } = repo.settleRoundInDb(
        guildId,
        roundId,
        dice,
      );
      const png = renderDiceRevealPng({ dice, revealedCount: 3, roundId });

      await upsertTableMessage(ctx, channelId, {
        embeds: buildResultEmbeds({
          roundId,
          settlement,
          userBalances,
        }),
        components: [],
        files: [new AttachmentBuilder(png, { name: 'dice-result.png' })],
        attachments: [],
      });

      return { totalBets };
    },
    renderClosed: async ({ channelId, reason }) => {
      const ctx = getContext();
      clearPendingEdit(ctx, channelId);
      ctx.tableMessages.delete(channelId);

      const note =
        reason === 'EMPTY'
          ? '🛑 Bàn Tài Xỉu đã tạm nghỉ do 2 phiên liên tiếp không có người cược. Gõ `.tx` để mở lại!'
          : '🛑 Bàn Tài Xỉu đã đóng.';

      const channel = await ctx.client.channels.fetch(channelId);
      if (channel && channel.isTextBased() && !channel.isDMBased() && 'send' in channel) {
        await channel.send(note);
      }
    },
    onError: (err, { channelId }) => {
      const ctx = getContext();
      clearPendingEdit(ctx, channelId);
      ctx.tableMessages.delete(channelId);
      console.error(`[TableManager] Error in channel ${channelId}:`, err);
    },
  });
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  ctx: BotContext,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Bot chỉ hỗ trợ chơi trong server Discord.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split(':');
  const action = parts[0];

  if (action === 'tx_stats') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const history = ctx.repo.getRecentHistory(interaction.guildId, 20);
    const png = getCachedStatsChartPng(interaction.guildId, history);
    await interaction.editReply({
      content: `📊 Thống kê ${history.length} phiên gần nhất (chỉ mình bạn thấy):`,
      files: [new AttachmentBuilder(png, { name: 'thong-ke-20-phien.png' })],
    });
    return;
  }

  if (action === 'tx_lixi') {
    const packetId = Number(parts[1]);
    if (!Number.isInteger(packetId)) return;

    const res = ctx.repo.claimLixiPacket(packetId, interaction.user.id);
    if (!res.ok) {
      await interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
      return;
    }

    if (res.packet.status !== 'OPEN') {
      const timer = ctx.lixiTimers.get(packetId);
      if (timer) {
        clearTimeout(timer);
        ctx.lixiTimers.delete(packetId);
      }
    }

    try {
      await interaction.message.edit({
        embeds: [buildLixiEmbed(res.packet, res.claims)],
        components: [buildLixiButtons(packetId, res.packet.status !== 'OPEN')],
      });
    } catch {
      // Ignore edit race if message was removed.
    }

    await interaction.reply({
      content: `🧧 Chúc mừng! Bạn vừa giật được **+${formatCoins(res.amount)}**!\n💳 Số dư hiện tại: **${formatCoins(res.newBalance)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'tx_quest_claim') {
    const ownerId = parts[1];
    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: '❌ Hãy gõ `.nv` để xem và nhận thưởng nhiệm vụ của riêng bạn!',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const res = ctx.repo.claimDailyQuestRewards(interaction.guildId, interaction.user.id);
    if (res.totalReward === 0) {
      await interaction.reply({
        content: '⏳ Bạn chưa có nhiệm vụ nào hoàn thành để nhận thưởng.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { embed, hasClaimable } = buildQuestsEmbed(res.progress, res.newBalance);
    await interaction.update({
      embeds: [embed],
      components: [buildQuestsButtons(hasClaimable, ownerId)],
    });
    await interaction.followUp({
      content: `🎁 Bạn đã nhận **+${formatCoins(res.totalReward)}** từ nhiệm vụ ngày! Số dư hiện tại: **${formatCoins(res.newBalance)}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'tx_solo_accept' || action === 'tx_solo_decline') {
    const challengeId = parts[1];
    if (!challengeId) return;
    const challenge = ctx.soloChallenges.get(challengeId);
    if (!challenge || challenge.settled) {
      await interaction.reply({
        content: '⏳ Kèo solo này đã hết hạn hoặc đã xử lý rồi.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.user.id !== challenge.opponentId) {
      await interaction.reply({
        content: `❌ Chỉ có <@${challenge.opponentId}> mới được bấm nút này!`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    challenge.settled = true;
    clearTimeout(challenge.timer);
    ctx.soloChallenges.delete(challengeId);

    if (action === 'tx_solo_decline') {
      await interaction.update({
        content: `❌ <@${challenge.opponentId}> đã từ chối kèo solo **${formatCoins(challenge.amount)}**.`,
        embeds: [],
        components: [buildSoloChallengeButtons(challengeId, true)],
      });
      return;
    }

    await interaction.deferUpdate();

    const cDice = rollDice();
    const oDice = rollDice();
    const res = ctx.repo.settleSoloMatch(
      challenge.guildId,
      challenge.challengerId,
      challenge.opponentId,
      challenge.amount,
      cDice,
      oDice,
    );

    if (!res.ok) {
      await interaction.editReply({
        content: `❌ Không thể bắt đầu solo: ${res.error}`,
        embeds: [],
        components: [],
      });
      return;
    }

    const cUser = await ctx.client.users.fetch(challenge.challengerId).catch(() => null);
    const oUser = interaction.user;
    const png = renderSoloComparisonPng({
      challengerName: cUser?.username ?? 'Người thách đấu',
      challengerDice: cDice,
      opponentName: oUser.username,
      opponentDice: oDice,
    });

    await interaction.editReply({
      content: '',
      embeds: [
        buildSoloResultEmbed({
          challengerId: challenge.challengerId,
          opponentId: challenge.opponentId,
          amount: challenge.amount,
          winnerId: res.winnerId,
          challengerSum: res.challengerSum,
          opponentSum: res.opponentSum,
        }),
      ],
      components: [],
      files: [new AttachmentBuilder(png, { name: 'solo-result.png' })],
      attachments: [],
    });
    return;
  }

  // Round betting buttons: tx_bet:<roundId>:<side> | tx_repeat:<roundId>
  const roundId = Number(parts[1]);
  if (!Number.isInteger(roundId) || !ctx.tableManager.isBettingOpen(interaction.channelId, roundId)) {
    await interaction.reply({
      content: 'Phiên cược này đã khóa sổ hoặc kết thúc.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'tx_bet') {
    const side = parts[2];
    if (!side || !isBetSide(side)) return;
    const user = ctx.repo.ensureUser(interaction.guildId, interaction.user.id);
    await interaction.showModal(buildBetModal(roundId, side, user.balance));
    return;
  }

  if (action === 'tx_pick') {
    const kind = parts[2];
    if (kind !== 'SO' && kind !== 'TONG') return;
    const user = ctx.repo.ensureUser(interaction.guildId, interaction.user.id);
    await interaction.showModal(buildNumberOrSumBetModal(roundId, kind, user.balance));
    return;
  }

  if (action === 'tx_repeat') {
    const res = ctx.repo.repeatLastBet(interaction.guildId, roundId, interaction.user.id);
    if (!res.ok) {
      await interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral });
      return;
    }

    scheduleBettingRefresh(ctx, interaction.channelId);
    const summary = res.placed
      .map((p) => `${getBetSideLabel(p.side)}: **${formatCoins(p.amount)}**`)
      .join(' | ');
    await interaction.reply({
      content: `✅ Đã cược lại: ${summary}\n💳 Số dư còn: **${formatCoins(res.newBalance)}**`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  ctx: BotContext,
): Promise<void> {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: 'Bot chỉ hỗ trợ chơi trong server Discord.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const parts = interaction.customId.split(':');
  const modalKind = parts[0];
  if (modalKind !== 'tx_modal' && modalKind !== 'tx_modal_pick') return;

  const roundId = Number(parts[1]);
  if (!Number.isInteger(roundId)) return;

  if (!ctx.tableManager.isBettingOpen(interaction.channelId, roundId)) {
    await interaction.reply({
      content: '⏰ Phiên cược này đã khóa sổ trước khi bạn xác nhận.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let side: BetSide;
  if (modalKind === 'tx_modal_pick') {
    const kind = parts[2];
    const rawTarget = interaction.fields.getTextInputValue('bet_target').trim();
    if (!/^\d+$/.test(rawTarget)) {
      await interaction.reply({
        content: '❌ Vui lòng nhập một số nguyên hợp lệ.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const num = Number(rawTarget);
    if (kind === 'SO') {
      if (num < 1 || num > 6) {
        await interaction.reply({
          content: '❌ Cược Số chỉ nhận giá trị từ **1** đến **6**.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      side = `SO_${num}` as BetSide;
    } else if (kind === 'TONG') {
      if (num < 3 || num > 18) {
        await interaction.reply({
          content: '❌ Cược Tổng chỉ nhận giá trị từ **3** đến **18**.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      side = `TONG_${num}` as BetSide;
    } else {
      return;
    }
  } else {
    const rawSide = parts[2];
    if (!rawSide || !isBetSide(rawSide)) return;
    side = rawSide;
  }

  const user = ctx.repo.ensureUser(interaction.guildId, interaction.user.id);
  const rawInput = interaction.fields.getTextInputValue('bet_amount');
  const parsed = parseBetAmount(rawInput, user.balance);
  if (!parsed.ok) {
    await interaction.reply({ content: `❌ ${parsed.error}`, flags: MessageFlags.Ephemeral });
    return;
  }

  const placed = ctx.repo.placeBet(
    interaction.guildId,
    roundId,
    interaction.user.id,
    side,
    parsed.amount,
  );
  if (!placed.ok) {
    await interaction.reply({ content: `❌ ${placed.error}`, flags: MessageFlags.Ephemeral });
    return;
  }

  scheduleBettingRefresh(ctx, interaction.channelId);
  await interaction.reply({
    content: `✅ Đã đặt **${formatCoins(parsed.amount)}** vào cửa **${getBetSideLabel(side)}** (Phiên #${roundId}).\n💳 Số dư còn: **${formatCoins(placed.newBalance)}**`,
    flags: MessageFlags.Ephemeral,
  });
}
