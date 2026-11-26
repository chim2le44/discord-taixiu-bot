import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { openDatabase } from './db/database.js';
import { Repository } from './db/repository.js';
import { handlePrefixCommand, handleSlashCommand } from './discord/commands.js';
import {
  createTableManager,
  handleButtonInteraction,
  handleModalSubmit,
  scheduleLixiExpiration,
  type BotContext,
} from './discord/interactions.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.resolve(projectRoot, process.env.DB_PATH || './data/taixiu.sqlite');
const db = openDatabase(dbPath);
console.log(`[DB] Using SQLite database at ${dbPath}`);
const repo = new Repository(db);

const recovery = repo.refundOpenRounds();
if (recovery.refundedRounds > 0) {
  console.log(
    `[Recovery] Refunded ${recovery.refundedBets} bets (${recovery.refundedAmount} xu) across ${recovery.refundedRounds} unfinished round(s).`,
  );
}

const lixiRecovery = repo.expireLixiPackets();
if (lixiRecovery.expiredCount > 0) {
  console.log(
    `[Recovery] Expired ${lixiRecovery.expiredCount} lixi packet(s) and refunded ${lixiRecovery.refundedAmount} xu.`,
  );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let ctx!: BotContext;
const tableManager = createTableManager(() => ctx, repo);

ctx = {
  client,
  repo,
  tableManager,
  tableMessages: new Map(),
  bettingMessages: new Map(),
  lastEditAt: new Map(),
  pendingEditTimers: new Map(),
  lixiTimers: new Map(),
  soloChallenges: new Map(),
};

client.once(Events.ClientReady, (readyClient) => {
  for (const packet of repo.getOpenLixiPackets()) {
    scheduleLixiExpiration(ctx, packet.id, packet.expiresAt);
  }
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, ctx);
    } else if (interaction.isButton()) {
      await handleButtonInteraction(interaction, ctx);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction, ctx);
    }
  } catch (err) {
    console.error('[InteractionCreate] Unhandled error:', err);
    if (interaction.isRepliable()) {
      const replyPayload = {
        content: '❌ Đã xảy ra lỗi khi xử lý thao tác. Vui lòng thử lại.',
        flags: MessageFlags.Ephemeral,
      } as const;
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(replyPayload);
        } else {
          await interaction.reply(replyPayload);
        }
      } catch {
        // Ignore secondary reply failure.
      }
    }
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handlePrefixCommand(message, ctx);
  } catch (err) {
    console.error('[MessageCreate] Unhandled error:', err);
    try {
      await message.reply('❌ Đã xảy ra lỗi khi xử lý lệnh. Vui lòng thử lại.');
    } catch {
      // Ignore secondary reply failure.
    }
  }
});

let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down gracefully...');
  tableManager.stopAll();
  for (const timer of ctx.pendingEditTimers.values()) {
    clearTimeout(timer);
  }
  ctx.pendingEditTimers.clear();
  for (const timer of ctx.lixiTimers.values()) {
    clearTimeout(timer);
  }
  ctx.lixiTimers.clear();
  for (const solo of ctx.soloChallenges.values()) {
    clearTimeout(solo.timer);
  }
  ctx.soloChallenges.clear();
  client.destroy();
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // Ignore checkpoint errors if DB is already closing.
  }
  db.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
if (process.platform === 'win32') {
  process.on('SIGBREAK', shutdown);
}

await client.login(token);
