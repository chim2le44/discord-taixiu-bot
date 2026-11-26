import { randomUUID } from 'node:crypto';
import {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Message,
  type User,
} from 'discord.js';
import { parseBetAmount } from '../engine/betParser.js';
import { GAME_CONFIG } from '../engine/types.js';
import {
  buildLixiButtons,
  buildLixiEmbed,
  buildQuestsButtons,
  buildQuestsEmbed,
  buildSoloChallengeButtons,
  buildSoloChallengeEmbed,
  formatCoins,
  formatLoseStreakTag,
} from './embeds.js';
import {
  getCachedStatsChartPng,
  scheduleLixiExpiration,
  type BotContext,
  type SoloChallenge,
} from './interactions.js';

export const COMMAND_PREFIX = '.';

/** Slash commands: public /hd guide plus admin commands (verified at runtime). */
export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('hd')
    .setDescription('Xem hướng dẫn đầy đủ các lệnh của bot Tài Xỉu'),
  new SlashCommandBuilder()
    .setName('admin-kenh')
    .setDescription('Chỉ định kênh được phép mở bàn Tài Xỉu (bỏ trống để mở lại mọi kênh)')
    .addChannelOption((opt) =>
      opt
        .setName('kenh')
        .setDescription('Kênh văn bản cho phép chơi')
        .addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder()
    .setName('admin-xu')
    .setDescription('Cộng hoặc trừ xu của một người chơi trong server')
    .addUserOption((opt) =>
      opt.setName('nguoi_choi').setDescription('Người chơi').setRequired(true),
    )
    .addIntegerOption((opt) =>
      opt
        .setName('so_xu')
        .setDescription('Số xu cộng (dương) hoặc trừ (âm)')
        .setRequired(true),
    ),
];

function hasAdminPermission(interaction: ChatInputCommandInteraction): boolean {
  if (interaction.guild?.ownerId === interaction.user.id) {
    return true;
  }
  const perms = interaction.memberPermissions;
  if (!perms) {
    return false;
  }
  return (
    perms.has(PermissionFlagsBits.Administrator) ||
    perms.has(PermissionFlagsBits.ManageGuild) ||
    perms.has(PermissionFlagsBits.ManageChannels) ||
    perms.has(PermissionFlagsBits.ModerateMembers)
  );
}

function buildHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle('📖 DANH SÁCH LỆNH TÀI XỈU')
    .setDescription(
      [
        '**🎲 Chơi & Soi cầu**',
        '• `.tx` *(`.taixiu`)* — Mở bàn Tài Xỉu',
        '• `.cau` — Biểu đồ thống kê 20 phiên',
        '',
        '**💰 Ví xu & Quà**',
        '• `.tanthu` — Quà tân thủ **50M xu** *(1 lần/server)*',
        '• `.dd` *(`.daily`)* — Điểm danh nhận **5k xu/ngày**',
        '• `.ct` *(`.cuutro`)* — Cứu trợ **1.5k xu** khi về 0',
        '• `.nv` *(`.nhiemvu`)* — Nhiệm vụ nhận xu mỗi ngày',
        '• `.vi` *(`.profile`)* — Xem ví & Thánh Đen (`.vi @tên`)',
        '• `.top` — BXH Đại gia, Chuỗi thắng & Thánh Đen',
        '',
        '**🤝 Giao lưu**',
        '• `.ck @tên <xu>` *(`.chuyen`)* — Chuyển xu (VD: `.ck @A 5k`)',
        '• `.lixi <tổng> <suất>` — Thả lì xì (VD: `.lixi 10k 5`)',
        '• `.solo @tên <xu>` — Solo 1v1 (VD: `.solo @A 2k`)',
        '',
        '**⚡ Đặc biệt**',
        '• **Giờ Vàng (15%):** Tài/Xỉu & Chẵn/Lẻ **x2.1**, góp Hũ **10%**',
        '• **Thánh Đen:** Thua 3/5/8 ván → `🤡` / `💀` hoàn 15% / `☠️` hoàn 25%',
        '',
        '*Hướng dẫn: `/hd` • Quản trị (Chủ server / Admin / Mod): `/admin-kenh`, `/admin-xu`*',
      ].join('\n'),
    );
}

export async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  ctx: BotContext,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: 'Các lệnh Tài Xỉu chỉ hoạt động trong server Discord.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildId = interaction.guildId;

  switch (interaction.commandName) {
    case 'hd': {
      await interaction.reply({
        embeds: [buildHelpEmbed()],
      });
      return;
    }

    case 'admin-kenh': {
      if (!hasAdminPermission(interaction)) {
        await interaction.reply({
          content: '❌ Chỉ Chủ server hoặc Quản trị viên (Admin/Mod) mới được dùng lệnh này.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const channel = interaction.options.getChannel('kenh');
      ctx.repo.setAllowedChannel(guildId, channel ? channel.id : null);
      await interaction.reply({
        content: channel
          ? `✅ Đã khóa kênh chơi Tài Xỉu tại <#${channel.id}>.`
          : '✅ Đã mở lại: cho phép chơi Tài Xỉu ở mọi kênh trong server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    case 'admin-xu': {
      if (!hasAdminPermission(interaction)) {
        await interaction.reply({
          content: '❌ Chỉ Chủ server hoặc Quản trị viên (Admin/Mod) mới được dùng lệnh này.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const target = interaction.options.getUser('nguoi_choi', true);
      if (target.bot) {
        await interaction.reply({
          content: '❌ Không thể chỉnh xu của bot.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const delta = interaction.options.getInteger('so_xu', true);
      if (delta === 0) {
        await interaction.reply({
          content: '❌ Số xu thay đổi phải khác 0.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const res = ctx.repo.adminAdjustCoins(guildId, target.id, delta);
      await interaction.reply({
        content: `✅ Đã cập nhật ví của <@${target.id}>: ${formatCoins(res.previousBalance)} → **${formatCoins(res.newBalance)}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }
}

async function resolveMentionUser(
  message: Message,
  ctx: BotContext,
  token: string | undefined,
): Promise<User | null> {
  if (!token) return null;
  const match = /^<@!?(\d+)>$/.exec(token.trim());
  if (!match) return null;
  const targetId = match[1];
  const fromMention = message.mentions.users.get(targetId);
  if (fromMention) return fromMention;
  return ctx.client.users.fetch(targetId).catch(() => null);
}

export async function handlePrefixCommand(message: Message, ctx: BotContext): Promise<void> {
  if (message.author.bot || !message.guildId) return;
  if (!message.content.startsWith(COMMAND_PREFIX)) return;

  const body = message.content.slice(COMMAND_PREFIX.length).trim();
  if (!body) return;

  const args = body.split(/\s+/);
  const cmd = args[0].toLowerCase();
  const guildId = message.guildId;
  const userId = message.author.id;

  switch (cmd) {
    case 'tx':
    case 'taixiu': {
      const settings = ctx.repo.getGuildSettings(guildId);
      if (settings.allowedChannelId && settings.allowedChannelId !== message.channelId) {
        await message.reply(
          `❌ Server đang khóa bàn Tài Xỉu tại kênh <#${settings.allowedChannelId}>.`,
        );
        return;
      }

      if (ctx.tableManager.getTable(message.channelId)) {
        await message.reply('🎲 Kênh này đang có bàn Tài Xỉu hoạt động rồi!');
        return;
      }

      const started = await ctx.tableManager.startTable(guildId, message.channelId);
      if (!started) {
        await message.reply('🎲 Kênh này đang có bàn Tài Xỉu hoạt động rồi!');
      }
      return;
    }

    case 'cau': {
      const history = ctx.repo.getRecentHistory(guildId, 20);
      const png = getCachedStatsChartPng(guildId, history);
      await message.reply({
        content: `📊 **Thống kê ${history.length} phiên gần nhất:**`,
        files: [new AttachmentBuilder(png, { name: 'thong-ke-20-phien.png' })],
      });
      return;
    }

    case 'daily':
    case 'dd': {
      const res = ctx.repo.claimDaily(guildId, userId);
      if (!res.ok) {
        const unix = res.nextAvailableAtMs ? Math.floor(res.nextAvailableAtMs / 1000) : null;
        await message.reply(
          unix ? `⏳ ${res.error} Quay lại <t:${unix}:R>.` : `⏳ ${res.error}`,
        );
        return;
      }
      await message.reply(
        `🎁 <@${userId}> đã điểm danh nhận **+${formatCoins(res.amount)}**! Số dư hiện tại: **${formatCoins(res.newBalance)}**.`,
      );
      return;
    }

    case 'cuutro':
    case 'ct': {
      const res = ctx.repo.claimBailout(guildId, userId);
      if (!res.ok) {
        const unix = res.nextAvailableAtMs ? Math.floor(res.nextAvailableAtMs / 1000) : null;
        await message.reply(
          unix ? `⏳ ${res.error} Thử lại <t:${unix}:R>.` : `❌ ${res.error}`,
        );
        return;
      }
      await message.reply(
        `🛟 Bạn đã nhận **+${formatCoins(res.amount)}** cứu trợ! Hãy chơi cẩn thận nhé.`,
      );
      return;
    }

    case 'tanthu': {
      const res = ctx.repo.claimNewbieGift(guildId, userId);
      if (!res.ok) {
        await message.reply(`❌ ${res.error}`);
        return;
      }
      await message.reply(
        `🎉 <@${userId}> đã nhận quà tân thủ **+${formatCoins(res.amount)}**! Số dư hiện tại: **${formatCoins(res.newBalance)}**.`,
      );
      return;
    }

    case 'nv':
    case 'nhiemvu': {
      const user = ctx.repo.ensureUser(guildId, userId);
      const progress = ctx.repo.getDailyQuests(guildId, userId);
      const { embed, hasClaimable } = buildQuestsEmbed(progress, user.balance);
      await message.reply({
        embeds: [embed],
        components: [buildQuestsButtons(hasClaimable, userId)],
      });
      return;
    }

    case 'vi':
    case 'profile': {
      let target = message.author;
      if (args[1]) {
        const mentioned = await resolveMentionUser(message, ctx, args[1]);
        if (!mentioned) {
          await message.reply('❌ Cách dùng: `.vi` hoặc `.vi @tên`');
          return;
        }
        target = mentioned;
      }

      if (target.bot) {
        await message.reply('❌ Bot không có ví xu.');
        return;
      }

      const stats = ctx.repo.ensureUser(guildId, target.id);
      const winRate =
        stats.totalGames > 0 ? ((stats.totalWins / stats.totalGames) * 100).toFixed(1) : '0.0';
      const profitSign = stats.netProfit > 0 ? '+' : '';
      const loseTag = formatLoseStreakTag(stats.currentLoseStreak);
      const bestLoseTag = formatLoseStreakTag(stats.bestLoseStreak);

      const embed = new EmbedBuilder()
        .setColor(0x10b981)
        .setTitle(`💼 Hồ sơ Tài Xỉu — ${target.username}`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: '💰 Số dư', value: formatCoins(stats.balance), inline: true },
          { name: '🎮 Số ván đã chơi', value: `${stats.totalGames}`, inline: true },
          { name: '🏆 Tỉ lệ thắng', value: `${winRate}% (${stats.totalWins} thắng)`, inline: true },
          { name: '🔥 Chuỗi thắng', value: `${stats.currentStreak} ván`, inline: true },
          { name: '👑 Thắng dài nhất', value: `${stats.bestStreak} ván`, inline: true },
          {
            name: '📈 Lời/Lỗ ròng',
            value: `${profitSign}${formatCoins(stats.netProfit)}`,
            inline: true,
          },
          {
            name: '💀 Chuỗi thua hiện tại',
            value: loseTag ? `${stats.currentLoseStreak} ván (${loseTag})` : `${stats.currentLoseStreak} ván`,
            inline: true,
          },
          {
            name: '☠️ Kỷ lục Thánh Đen',
            value: bestLoseTag ? `${stats.bestLoseStreak} ván (${bestLoseTag})` : `${stats.bestLoseStreak} ván`,
            inline: true,
          },
        );

      await message.reply({ embeds: [embed] });
      return;
    }

    case 'top': {
      const richest = ctx.repo.getLeaderboard(guildId, 'balance', 10);
      const streaks = ctx.repo.getLeaderboard(guildId, 'streak', 10);
      const unluckiest = ctx.repo.getLeaderboard(guildId, 'lose_streak', 10);
      const settings = ctx.repo.getGuildSettings(guildId);

      const richText =
        richest.length > 0
          ? richest
              .map((u, idx) => `${idx + 1}. <@${u.userId}> — **${formatCoins(u.balance)}**`)
              .join('\n')
          : 'Chưa có dữ liệu';

      const streakText =
        streaks.length > 0
          ? streaks
              .map((u, idx) => `${idx + 1}. <@${u.userId}> — **${u.bestStreak} ván**`)
              .join('\n')
          : 'Chưa có dữ liệu';

      const unluckyText =
        unluckiest.length > 0
          ? unluckiest
              .map((u, idx) => {
                const tag = formatLoseStreakTag(u.bestLoseStreak);
                return `${idx + 1}. <@${u.userId}> — **${u.bestLoseStreak} ván** ${tag}`.trim();
              })
              .join('\n')
          : 'Chưa có Thánh Đen nào (>= 3 ván)';

      const embed = new EmbedBuilder()
        .setColor(0xf59e0b)
        .setTitle('🏆 BẢNG XẾP HẠNG TÀI XỈU')
        .setDescription(`💰 **Hũ Jackpot hiện tại:** ${formatCoins(settings.jackpotPool)}`)
        .addFields(
          { name: '💎 Top 10 Đại gia', value: richText, inline: true },
          { name: '🔥 Top 10 Chuỗi thắng', value: streakText, inline: true },
          { name: '💀 Top 10 Thánh Đen', value: unluckyText, inline: true },
        );

      await message.reply({ embeds: [embed] });
      return;
    }

    case 'ck':
    case 'chuyen': {
      const target = await resolveMentionUser(message, ctx, args[1]);
      const rawAmount = args[2];
      if (!target || !rawAmount) {
        await message.reply('❌ Cách dùng: `.ck @tên <số_xu>` (VD: `.ck @A 5k`)');
        return;
      }
      if (target.bot) {
        await message.reply('❌ Không thể chuyển xu cho bot.');
        return;
      }

      const sender = ctx.repo.ensureUser(guildId, userId);
      const parsed = parseBetAmount(rawAmount, sender.balance);
      if (!parsed.ok) {
        await message.reply(`❌ ${parsed.error}`);
        return;
      }

      const res = ctx.repo.transferCoins(guildId, userId, target.id, parsed.amount);
      if (!res.ok) {
        await message.reply(`❌ ${res.error}`);
        return;
      }

      await message.reply(
        `💸 <@${userId}> đã chuyển **${formatCoins(res.received)}** cho <@${target.id}> (thuế ${formatCoins(res.tax)} đã góp vào Hũ Jackpot).`,
      );
      return;
    }

    case 'lixi': {
      const rawTotal = args[1];
      const rawSlots = args[2];
      if (!rawTotal || !rawSlots || !/^\d+$/.test(rawSlots)) {
        await message.reply('❌ Cách dùng: `.lixi <tổng_xu> <số_suất>` (VD: `.lixi 10k 5`)');
        return;
      }
      const slots = Number(rawSlots);
      if (slots < 1 || slots > GAME_CONFIG.LIXI_MAX_SLOTS) {
        await message.reply(
          `❌ Số suất lì xì phải từ **1** đến **${GAME_CONFIG.LIXI_MAX_SLOTS}**.`,
        );
        return;
      }

      const creator = ctx.repo.ensureUser(guildId, userId);
      const parsed = parseBetAmount(rawTotal, creator.balance, GAME_CONFIG.LIXI_MIN_TOTAL);
      if (!parsed.ok) {
        await message.reply(`❌ ${parsed.error}`);
        return;
      }

      const created = ctx.repo.createLixiPacket(
        guildId,
        message.channelId,
        userId,
        parsed.amount,
        slots,
      );
      if (!created.ok) {
        await message.reply(`❌ ${created.error}`);
        return;
      }

      const sent = await message.reply({
        embeds: [buildLixiEmbed(created.packet, [])],
        components: [buildLixiButtons(created.packet.id, false)],
      });
      ctx.repo.setLixiMessageId(created.packet.id, sent.id);
      scheduleLixiExpiration(ctx, created.packet.id, created.packet.expiresAt);
      return;
    }

    case 'solo': {
      const opponent = await resolveMentionUser(message, ctx, args[1]);
      const rawAmount = args[2];
      if (!opponent || !rawAmount) {
        await message.reply('❌ Cách dùng: `.solo @tên <số_xu>` (VD: `.solo @A 2k`)');
        return;
      }
      if (opponent.bot) {
        await message.reply('❌ Không thể thách đấu bot.');
        return;
      }
      if (opponent.id === userId) {
        await message.reply('❌ Không thể tự thách đấu chính mình.');
        return;
      }

      const challenger = ctx.repo.ensureUser(guildId, userId);
      const parsed = parseBetAmount(rawAmount, challenger.balance);
      if (!parsed.ok) {
        await message.reply(`❌ ${parsed.error}`);
        return;
      }

      const oppRecord = ctx.repo.ensureUser(guildId, opponent.id);
      if (oppRecord.balance < parsed.amount) {
        await message.reply(
          `❌ <@${opponent.id}> chỉ có **${formatCoins(oppRecord.balance)}**, không đủ theo kèo **${formatCoins(parsed.amount)}**.`,
        );
        return;
      }

      const challengeId = randomUUID().slice(0, 8);
      const expiresAtMs = Date.now() + GAME_CONFIG.SOLO_EXPIRE_MS;

      const timer = setTimeout(async () => {
        const c = ctx.soloChallenges.get(challengeId);
        if (!c || c.settled) return;
        c.settled = true;
        ctx.soloChallenges.delete(challengeId);
        if (c.message) {
          try {
            await c.message.edit({
              content: `⌛ Kèo solo giữa <@${userId}> và <@${opponent.id}> đã hết hạn.`,
              components: [buildSoloChallengeButtons(challengeId, true)],
            });
          } catch {
            // Ignore deleted challenge message.
          }
        }
      }, GAME_CONFIG.SOLO_EXPIRE_MS);

      const challenge: SoloChallenge = {
        id: challengeId,
        guildId,
        channelId: message.channelId,
        challengerId: userId,
        opponentId: opponent.id,
        amount: parsed.amount,
        timer,
        message: null,
        settled: false,
      };
      ctx.soloChallenges.set(challengeId, challenge);

      const sent = await message.reply({
        content: `<@${opponent.id}>`,
        embeds: [
          buildSoloChallengeEmbed({
            challengerId: userId,
            opponentId: opponent.id,
            amount: parsed.amount,
            expiresAtMs,
          }),
        ],
        components: [buildSoloChallengeButtons(challengeId, false)],
      });
      challenge.message = sent;
      return;
    }

    default:
      // Ignore normal chat messages starting with '.' such as '...'
      return;
  }
}
