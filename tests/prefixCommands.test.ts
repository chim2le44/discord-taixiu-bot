import type { Client, Message } from 'discord.js';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import { commandDefinitions, handlePrefixCommand } from '../src/discord/commands.js';
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

  it('registers only admin slash commands', () => {
    expect(commandDefinitions.map((c) => c.name)).toEqual(['admin-kenh', 'admin-xu']);
  });

  it('handles .daily, .vi, .top, .chuyen, .nv, .help, .tx and ignores normal dot chat', async () => {
    // 1) Ignore normal chat starting with '.'
    const dots = createMockMessage('...');
    await handlePrefixCommand(dots.message, ctx);
    const unknown = createMockMessage('.khongtontai');
    await handlePrefixCommand(unknown.message, ctx);
    expect(dots.replyMock).not.toHaveBeenCalled();
    expect(unknown.replyMock).not.toHaveBeenCalled();

    // 2) .daily
    const daily = createMockMessage('.daily');
    await handlePrefixCommand(daily.message, ctx);
    expect(daily.replyMock).toHaveBeenCalledTimes(1);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(15_000);

    // 3) .chuyen @u2 500
    const transfer = createMockMessage('.chuyen <@222222222222222222> 500');
    await handlePrefixCommand(transfer.message, ctx);
    expect(transfer.replyMock).toHaveBeenCalledTimes(1);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(14_500);
    expect(repo.ensureUser('g1', '222222222222222222').balance).toBe(10_475);

    // 4) .vi
    const profile = createMockMessage('.vi');
    await handlePrefixCommand(profile.message, ctx);
    expect(profile.replyMock).toHaveBeenCalledTimes(1);
    const profilePayload = profile.replyMock.mock.calls[0][0] as { embeds: Array<{ toJSON: () => { fields?: Array<{ name: string }> } }> };
    const fieldNames = profilePayload.embeds[0].toJSON().fields?.map((f) => f.name) ?? [];
    expect(fieldNames).toContain('💀 Chuỗi thua hiện tại');
    expect(fieldNames).toContain('☠️ Kỷ lục Thánh Đen');

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

    // 7) .help
    const help = createMockMessage('.help');
    await handlePrefixCommand(help.message, ctx);
    expect(help.replyMock).toHaveBeenCalledTimes(1);

    // 8) .tanthu grants 50m once and rejects second attempt
    const tanthu1 = createMockMessage('.tanthu');
    await handlePrefixCommand(tanthu1.message, ctx);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(50_014_500);

    const tanthu2 = createMockMessage('.tanthu');
    await handlePrefixCommand(tanthu2.message, ctx);
    expect(repo.ensureUser('g1', 'u1').balance).toBe(50_014_500);
    expect(String(tanthu2.replyMock.mock.calls[0][0])).toContain('đã nhận quà tân thủ rồi');

    // 9) .tx starts table
    const tx = createMockMessage('.tx');
    await handlePrefixCommand(tx.message, ctx);
    expect(ctx.tableManager.getTable('c1')).toBeDefined();
    expect(channelSendMock).toHaveBeenCalledTimes(1);
  });
});
