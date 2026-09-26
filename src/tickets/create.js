'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const config = require('../config/config');
const { slugify } = require('../utils/ids');
const { getClient } = require('../services/logs');

const STAFF_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
];

const CUSTOMER_ALLOW = STAFF_ALLOW.filter((p) => p !== PermissionFlagsBits.ManageMessages);

/** What the bot itself needs inside its own ticket channels. */
const BOT_ALLOW = [...STAFF_ALLOW, PermissionFlagsBits.ManageChannels];

/**
 * Private order ticket: visible only to the customer, staff role,
 * administrators and the bot.
 *
 * Overwrite targets are resolved by discord.js from the guild/user caches, so
 * a stale STAFF_ROLE_ID is detected here and reported instead of silently
 * producing a channel nobody but the customer can see.
 */
function overwritesFor(client, guild, user) {
  const list = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: client.user.id, allow: [...BOT_ALLOW] },
    { id: user.id, allow: [...CUSTOMER_ALLOW] },
  ];

  const staffRole = config.staffRoleId ? guild.roles.cache.get(config.staffRoleId) : null;
  if (staffRole) {
    list.push({ id: staffRole.id, allow: [...STAFF_ALLOW] });
  } else if (config.staffRoleId) {
    console.warn(
      `⚠️ STAFF_ROLE_ID "${config.staffRoleId}" is not a role in "${guild.name}" — ` +
        'staff will NOT see order tickets. Fix STAFF_ROLE_ID in .env.'
    );
  }
  return list;
}

/** True when the bot can actually use a channel (view + send). */
function botCanUse(channel, client) {
  const perms = channel.permissionsFor(client.user ?? client.application);
  return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
}

/**
 * Re-assert the bot's own overwrite and wait for Discord to apply it.
 *
 * Freshly created channels can briefly deny the bot (Discord applies the
 * permission change asynchronously), and a ticket category with restrictive
 * overwrites can deny it too — both surface as DiscordAPIError 50001
 * "Missing Access" on the very first message. This verifies and repairs.
 */
async function ensureBotAccess(channel, client, { retries = 2 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (botCanUse(channel, client)) return true;
    try {
      await channel.permissionOverwrites.edit(client.user, {
        ViewChannel: true,
        SendMessages: true,
        EmbedLinks: true,
        AttachFiles: true,
        ReadMessageHistory: true,
        ManageMessages: true,
        ManageChannels: true,
      });
    } catch {
      /* repair failed — retry/verify below decides */
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 400));
  }
  return botCanUse(channel, client);
}

/** Turn a Discord permission error into something an admin can act on. */
function permissionHint(err) {
  const code = err?.code;
  if (code === 50001) {
    return (
      '**Missing Access** — the bot cannot view the ticket channel. ' +
      'Give it **View Channel + Send Messages** there (and in the tickets ' +
      'category, if ORDER_CATEGORY_ID is set), or raise its role above the ' +
      'categories that deny it.'
    );
  }
  if (code === 50013) {
    return (
      '**Missing Permissions** — the bot needs **Send Messages, Embed Links, ' +
      'Attach Files** in the ticket channel/category (and Manage Channels to ' +
      'create tickets).'
    );
  }
  if (code === 50035) {
    return '**Invalid Form Body** — a component/embed was rejected; see the error log for details.';
  }
  return err?.message || 'unknown error — details are in the error log.';
}

async function createTicketChannel(client, guild, user, product) {
  // `product` may be a real product or just a label (category ticket opened
  // from the buy panel before the customer picks a product).
  const label = typeof product === 'string' ? product : product.name;
  const name = `order-${slugify(user.username, 20)}-${slugify(label, 20)}`.slice(0, 100);

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: config.orderCategoryId || null,
    permissionOverwrites: overwritesFor(client, guild, user),
    reason: `X SHOP order ticket for ${user.tag ?? user.username}`,
  });

  // Never hand back a channel the bot cannot post in — verify and repair.
  await ensureBotAccess(channel, client);
  return channel;
}

/** Private support ticket (from /support) — same permissions, no product. */
async function createSupportChannel(client, guild, user, topicLabel) {
  const name = `support-${slugify(user.username, 20)}`.slice(0, 100);

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: config.orderCategoryId || null,
    permissionOverwrites: overwritesFor(client, guild, user),
    reason: `X SHOP support ticket (${topicLabel}) for ${user.tag ?? user.username}`,
  });

  await ensureBotAccess(channel, client);
  return channel;
}

/**
 * Fetch the customer's ticket channel for an order (or a raw channel id).
 * Returns null when the ticket was deleted or the bot lost access to it.
 */
async function fetchTicketChannel(order) {
  const client = getClient();
  const channelId =
    order && typeof order === 'object' ? order.ticket_channel_id : order || null;
  if (!client || !channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    return channel && channel.isTextBased() ? channel : null;
  } catch {
    return null; // channel deleted / no access
  }
}

module.exports = {
  createTicketChannel,
  createSupportChannel,
  fetchTicketChannel,
  overwritesFor,
  ensureBotAccess,
  botCanUse,
  permissionHint,
};
