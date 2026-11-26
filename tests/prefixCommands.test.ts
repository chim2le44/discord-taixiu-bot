import { PermissionsBitField, type ChatInputCommandInteraction, type Client, type Message } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import {
  commandDefinitions,
  handlePrefixCommand,
  handleSlashCommand,
} from '../src/discord/commands.js';
import { createTableManager, type BotContext } from '../src/discord/interactions.js';

function createMockMessage(content: string, userId = 'u1') {
  const replyMock = vi.fn(async (payload: unknown) => ({ id: 'reply-1', payload }));
  const message = {
    content,
    guildId: 'g1',
    channelId: 'c1',
    author: {
      id: userId,
      username: `user-${userId}`,
      bot: false,
      displayAvatarURL: () => 'https://example.com/avatar.png',
    },
    mentions: {
      users: new Map([
        [
          '222222222222222222',
          {
            id: '222222222222222222',
            username: 'user-u2',
            bot: false,
            displayAvatarURL: () => 'https://example.com/u2.png',
          },
        ],
      ]),
    },
    reply: replyMock,
  } as unknown as Message;

  return { message, replyMock };
}

describe('Prefix commands & admin-only slash commands', () => {
  let db: DatabaseSync;
  let repo: Repository;
  let ctx: BotContext;
  let channelSendMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    db = openDatabase(':memory:');
    repo = new Repository(db);
    channelSendMock = vi.fn(async () => ({
      id: 'table-msg-1',
      edit: vi.fn(async () => ({})),
      delete: vi.fn(async () => undefined),
    }));
    const fakeChannel = {
      isTextBased: () => true,
      isDMBased: () => false,
      send: channelSendMock,
    };
    const fakeClient = {
      channels: { fetch: vi.fn(async () => fakeChannel) },
      users: { fetch: vi.fn(async () => null) },
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
  });

  afterEach(() => {
    ctx.tableManager.stopAll();
    for (const t of ctx.pendingEditTimers.values()) clearTimeout(t);
    for (const t of ctx.lixiTimers.values()) clearTimeout(t);
    for (const s of ctx.soloChallenges.values()) clearTimeout(s.timer);
    db.close();
    vi.useRealTimers();
  });

  it('registers /hd and visible admin slash commands without client hiding', () => {
    expect(commandDefinitions.map((c) => c.name)).toEqual(['hd', 'admin-kenh', 'admin-xu']);
    for (const def of commandDefinitions) {
      expect(def.toJSON().default_member_permissions).toBeUndefined();
    }
  });

  it('handles /hd for everyone and lets server owner & mods use /admin-xu while blocking regular users', async () => {
    const hdReply = vi.fn(async () => ({}));
    await handleSlashCommand(
      {
        guildId: 'g1',
        commandName: 'hd',
        user: { id: 'u-normal' },
        reply: hdReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(hdReply).toHaveBeenCalledTimes(1);
    expect((hdReply.mock.calls[0][0] as { flags?: unknown }).flags).toBeUndefined();

    // Server owner without memberPermissions still succeeds
    const ownerReply = vi.fn(async () => ({}));
    await handleSlashCommand(
      {
        guildId: 'g1',
        commandName: 'admin-xu',
        user: { id: 'owner-1' },
        guild: { ownerId: 'owner-1' },
        memberPermissions: null,
        options: {
          getUser: () => ({ id: 'u1', bot: false }),
          getInteger: () => 5_000,
        },
        reply: ownerReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(repo.ensureUser('g1', 'u1').balance).toBe(15_000);

    // Mod with ManageChannels succeeds
    const modReply = vi.fn(async () => ({}));
    await handleSlashCommand(
      {
        guildId: 'g1',
        commandName: 'admin-xu',
        user: { id: 'mod-1' },
        guild: { ownerId: 'owner-1' },
        memberPermissions: new PermissionsBitField(['ManageChannels']),
        options: {
          getUser: () => ({ id: 'u1', bot: false }),
          getInteger: () => 1_000,
        },
        reply: modReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(repo.ensureUser('g1', 'u1').balance).toBe(16_000);

    // Regular member is rejected without mutating balance
    const userReply = vi.fn(async () => ({}));
    await handleSlashCommand(
      {
        guildId: 'g1',
        commandName: 'admin-xu',
        user: { id: 'u-normal' },
        guild: { ownerId: 'owner-1' },
        memberPermissions: new PermissionsBitField(['SendMessages']),
        options: {
          getUser: () => ({ id: 'u1', bot: false }),
          getInteger: () => 999_999,
        },
        reply: userReply,
      } as unknown as ChatInputCommandInteraction,
      ctx,
    );
    expect(repo.ensureUser('g1', 'u1').balance).toBe(16_000);
    expect(String((userReply.mock.calls[0][0] as { content: string }).content)).toContain(
      'Chỉ Chủ server',
    );
  });

  it('handles both compact (.tx, .vi, .nv, .dd, .ck) and full (.taixiu, .profile, .nhiemvu, .daily, .chuyen) commands', async () => {
    // 1) Ignore normal chat starting with '.' and removed .help/.hd prefix
    for (const raw of ['...', '.khongtontai', '.help', '.hd']) {
      const m = createMockMessage(raw);
      await handlePrefixCommand(m.message, ctx);
      expect(m.replyMock).not.toHaveBeenCalled();
    }
    expect(channelSendMock).not.toHaveBeenCalled();

    // 2) .dd (alias for .daily)
    const daily = createMockMessage('.dd');
    await handlePrefixCommand(daily.message, ctx);
    expect(daily.replyMock).toHaveBeenCalledTimes(1);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(15_000);

    // 3) .ck @u2 500 (alias for .chuyen)
    const transfer = createMockMessage('.ck <@222222222222222222> 500');
    await handlePrefixCommand(transfer.message, ctx);
    expect(transfer.replyMock).toHaveBeenCalledTimes(1);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(14_500);
    expect(repo.ensureUser('g1', '222222222222222222').balance).toBe(10_475);

    // 4) .vi and .profile both work
    for (const cmd of ['.vi', '.profile']) {
      const profile = createMockMessage(cmd);
      await handlePrefixCommand(profile.message, ctx);
      expect(profile.replyMock).toHaveBeenCalledTimes(1);
      const profilePayload = profile.replyMock.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { fields?: Array<{ name: string }> } }> };
      const fieldNames = profilePayload.embeds[0].toJSON().fields?.map((f) => f.name) ?? [];
      expect(fieldNames).toContain('💀 Chuỗi thua hiện tại');
      expect(fieldNames).toContain('☠️ Kỷ lục Thánh Đen');
    }

    // 5) .top
    const top = createMockMessage('.top');
    await handlePrefixCommand(top.message, ctx);
    const topPayload = top.replyMock.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { fields?: Array<{ name: string }> } }> };
    expect(topPayload.embeds[0].toJSON().fields?.map((f) => f.name)).toContain('💀 Top 10 Thánh Đen');

    // 6) .nv attaches owner-scoped claim button
    const quests = createMockMessage('.nv');
    await handlePrefixCommand(quests.message, ctx);
    const questPayload = quests.replyMock.mock.calls[0][0] as {
      components: Array<{ toJSON: () => { components: Array<{ custom_id?: string }> } }>;
    };
    expect(questPayload.components[0].toJSON().components[0].custom_id).toBe('tx_quest_claim:u1');

    // 7) .tanthu grants 50m once and rejects second attempt
    const tanthu1 = createMockMessage('.tanthu');
    await handlePrefixCommand(tanthu1.message, ctx);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(50_014_500);

    const tanthu2 = createMockMessage('.tanthu');
    await handlePrefixCommand(tanthu2.message, ctx);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(50_014_500);
    expect(String(tanthu2.replyMock.mock.calls[0][0])).toContain('đã nhận quà tân thủ rồi');

    // 8) .tx starts table
    const tx = createMockMessage('.tx');
    await handlePrefixCommand(tx.message, ctx);
    expect(ctx.tableManager.getTable('c1')).toBeDefined();
    expect(channelSendMock).toHaveBeenCalledTimes(1);
  });
});
