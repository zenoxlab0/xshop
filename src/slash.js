'use strict';

/**
 * Customer-facing slash commands: /help, /orders, /support. Every staff/admin
 * prefix command from !xhelp is ALSO available as a slash command (see
 * ./slash-staff) — it runs the same handler with the same permission checks.
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const config = require('./config/config');
const orders = require('./orders/orders');
const { brand, COLORS, BULLET, DOT, fmtMoney, FOOTER, heroLines, section, quote, lead, e, eMaybe } = require('./utils/embeds');
const { replyEphemeral } = require('./utils/interactions');
const { isStaff } = require('./utils/perms');
const { onCooldown } = require('./services/antiSpam');
const { errorLog } = require('./services/logs');
const { createSupportChannel } = require('./tickets/create');
const { slugify } = require('./utils/ids');

const PAGE_SIZE = 5;

const STATUS_BADGES = {
  pending: `${e('pending')} Pending`,
  awaiting_payment: `${e('pending')} Awaiting Payment`,
  payment_review: `${e('review')} Under Review`,
  processing: `${e('processing')} Processing`,
  completed: `${e('completed')} Completed`,
  cancelled: `${e('cancelled')} Cancelled`,
  refunded: `${e('refunded')} Refunded`,
};

// ── /help ───────────────────────────────────────────────────────────────────

function helpEmbed() {
  return brand(COLORS.primary)
    .setTitle(`${e('shop')} X SHOP — Help Center`)
    .setDescription(
      [
        ...heroLines('Everything you need to order in a few clicks.'),
        section(`${e('cart')} SHOP`),
        quote(`Type **buy** in the shop channel to open the storefront`),
        quote(`Pick a category → pick a product → **Buy Now**`),
        '',
        section(`${e('order')} ORDERS`),
        quote(`\`/orders\` — track status, payment and delivery`),
        quote(`Your purchase happens in a **private ticket** only you can see`),
        '',
        section(`${e('ticket')} SUPPORT`),
        quote(`\`/support\` — open a private ticket with our team`),
        '',
        section(`${e('card')} PAYMENTS`),
        quote(`Pay with the method you pick, then upload the screenshot`),
        quote(`Staff verifies it — then your order is delivered`),
        '',
        quote(`${e('sparkle')} *Browsing is public, your purchase stays private.*`),
      ].join('\n')
    )
    .setFooter({ text: `${e('heart')} X SHOP • Fast • Secure • Simple` })
    .setTimestamp();
}

// ── /orders ─────────────────────────────────────────────────────────────────

function orderLine(o) {
  const badge = STATUS_BADGES[o.order_status] || o.order_status;
  const when = o.created_at ? o.created_at.slice(0, 10) : '';
  return [
    lead(eMaybe(o.product_name), `**${o.product_name}** — ${fmtMoney(o.total_price)}`),
    `${badge} • \`${o.order_id}\` • ${when}`,
    '',
  ];
}

function ordersEmbed(userId, page, total, pages) {
  const rows = orders.forUser(userId, PAGE_SIZE, page * PAGE_SIZE);
  const embed = brand(COLORS.primary)
    .setTitle(`${e('order')} YOUR ORDERS`)
    .setDescription(
      rows.length
        ? rows.flat().filter(Boolean).join('\n').trim()
        : [
            'No orders yet!',
            '',
            `Type **buy** in <#${config.shopChannelId}> to place your first order ${e('heart')}`,
          ].join('\n')
    )
    .setFooter({ text: `${FOOTER} • Page ${page + 1} of ${Math.max(1, pages)}` });
  void total;
  return embed;
}

function ordersRows(userId, page, pages) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ords:page:${userId}:${page - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId('ords:none')
        .setLabel(`Page ${page + 1} of ${Math.max(1, pages)}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`ords:page:${userId}:${page + 1}`)
        .setLabel('Next')
        .setEmoji(e('arrow'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= pages - 1)
    ),
  ];
}

async function runOrders(interaction) {
  const total = orders.countForUser(interaction.user.id);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = 0;
  await interaction.reply({
    embeds: [ordersEmbed(interaction.user.id, page, total, pages)],
    components: total > PAGE_SIZE ? ordersRows(interaction.user.id, page, pages) : [],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleOrdersButton(interaction) {
  const [, action, userId, pageRaw] = interaction.customId.split(':');
  if (action !== 'page') return;
  if (interaction.user.id !== userId) {
    return replyEphemeral(interaction, `${e('cancelled')} Only the person who ran \`/orders\` can browse these pages.`);
  }
  const total = orders.countForUser(userId);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(parseInt(pageRaw, 10) || 0, 0), pages - 1);
  await interaction.update({
    embeds: [ordersEmbed(userId, page, total, pages)],
    components: total > PAGE_SIZE ? ordersRows(userId, page, pages) : [],
  });
}

// ── /support ────────────────────────────────────────────────────────────────

const SUPPORT_TOPICS = [
  { id: 'payment', label: 'Payment Issue', emoji: 'card' },
  { id: 'order', label: 'Order Issue', emoji: 'order' },
  { id: 'product', label: 'Product Question', emoji: 'info' },
  { id: 'refund', label: 'Refund Request', emoji: 'money' },
  { id: 'other', label: 'Other', emoji: 'more' },
];

function supportEmbed() {
  const embed = brand(COLORS.primary)
    .setTitle(`${e('ticket')} X SHOP SUPPORT`)
    .setDescription('Need help? Choose a category below — a private ticket will open for you.');
  const rows = [];
  for (let i = 0; i < SUPPORT_TOPICS.length; i += 3) {
    rows.push(
      new ActionRowBuilder().addComponents(
        ...SUPPORT_TOPICS.slice(i, i + 3).map((t) =>
          new ButtonBuilder()
            .setCustomId(`sup:new:${t.id}`)
            .setLabel(t.label)
            .setEmoji(e(t.emoji))
            .setStyle(ButtonStyle.Secondary)
        )
      )
    );
  }
  return { embeds: [embed], components: rows };
}

async function runSupport(interaction) {
  await interaction.reply({ ...supportEmbed(), flags: MessageFlags.Ephemeral });
}

async function handleSupportButton(interaction) {
  const [, action, topicId] = interaction.customId.split(':');

  if (action === 'close') {
    if (!isStaff(interaction.member)) return replyEphemeral(interaction, `${e('cancelled')} Staff only.`);
    await interaction.reply({ content: `${e('lock')} Closing support ticket…` });
    setTimeout(() => interaction.channel?.delete('X SHOP support ticket closed').catch(() => {}), 3000);
    return;
  }

  if (action !== 'new') return;
  const topic = SUPPORT_TOPICS.find((t) => t.id === topicId) || SUPPORT_TOPICS[SUPPORT_TOPICS.length - 1];

  if (onCooldown(`support:${interaction.user.id}`, config.ticketCooldownMs)) {
    return replyEphemeral(interaction, `${e('pending')} You just opened a ticket — please wait a moment.`);
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const channel = await createSupportChannel(interaction.client, interaction.guild, interaction.user, topic.label);
    const embed = brand(COLORS.primary)
      .setTitle(`${e(topic.emoji)} Support Ticket — ${topic.label}`)
      .setDescription(
        [
          `${interaction.user}, describe your issue and our staff will help you shortly.`,
          '',
          '• Include **order IDs** and **screenshots** when relevant.',
          '• Staff are notified automatically.',
          quote(`Opened By ${BULLET} <@${interaction.user.id}>`),
        ].join('\n')
      );
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sup:close').setLabel('Close Ticket').setEmoji(e('lock')).setStyle(ButtonStyle.Danger)
    );
    await channel.send({ embeds: [embed], components: [closeRow] });
    await interaction.editReply({ content: `${e(topic.emoji)} Your support ticket: ${channel}` });
  } catch (err) {
    await errorLog('support-ticket', err);
    await interaction.editReply({ content: `${e('warning')} Could not open a support ticket — please contact staff.` });
  }
}

// ── Registration & routing ──────────────────────────────────────────────────

const { staffSlashBody, runStaffSlash } = require('./slash-staff');

// The three customer commands above are builders; staffSlashBody is ALREADY
// serialized JSON (slash-staff.js calls builder.toJSON() itself), so only
// builders may be converted — calling toJSON() on a plain object threw
// "c.toJSON is not a function" at require-time and blocked bot startup.
const slashBody = [
  new SlashCommandBuilder().setName('help').setDescription('X SHOP help — how to order, statuses & support'),
  new SlashCommandBuilder().setName('orders').setDescription('View your X SHOP orders and their status'),
  new SlashCommandBuilder().setName('support').setDescription('Get help from X SHOP staff — open a private ticket'),
  ...staffSlashBody,
].map((c) => (typeof c?.toJSON === 'function' ? c.toJSON() : c));

async function registerSlashCommands(client) {
  // Guild-scoped registration updates instantly and does not need the global
  // `applications.commands` scope to be re-authorised.
  const INVITE =
    `https://discord.com/api/oauth2/authorize?client_id=${config.clientId}` +
    '&permissions=125968&scope=bot%20applications.commands';

  const inGuild = [...client.guilds.cache.values()];

  if (!inGuild.length) {
    console.warn(
      '⚠️ The bot is not in any server yet — invite it first; slash commands ' +
        `register automatically on the next start.\n   Invite: ${INVITE}`
    );
    return;
  }

  // Preferred: the configured guild (fast + private to that server).
  if (config.guildId && client.guilds.cache.has(config.guildId)) {
    try {
      const guild = client.guilds.cache.get(config.guildId);
      await guild.commands.set(slashBody);
      console.log(`✦ Registered ${slashBody.length} slash command(s) in ${guild.name}`);
      return;
    } catch (err) {
      await errorLog('slash-register', err);
      console.warn(`⚠️ Slash registration failed in ${config.guildId}: ${err.message}`);
    }
  } else if (config.guildId) {
    // e.g. the bot was kicked/re-invited, or GUILD_ID belongs to another bot.
    console.warn(
      `⚠️ GUILD_ID ${config.guildId} is not a server this bot is in (it is in: ` +
        `${inGuild.map((g) => `${g.name} (${g.id})`).join(', ') || 'none'}). ` +
        `Fix GUILD_ID in .env, or re-invite the bot:\n   ${INVITE}`
    );
  }

  // Fallback: register in every server the bot is actually in.
  let ok = 0;
  for (const guild of inGuild) {
    try {
      await guild.commands.set(slashBody);
      ok++;
      console.log(`✦ Registered ${slashBody.length} slash command(s) in ${guild.name}`);
    } catch (err) {
      await errorLog(`slash-register:${guild.id}`, err);
      console.warn(
        `⚠️ Slash registration failed in ${guild.name}: ${err.message} — the bot needs the ` +
          '**applications.commands** scope (re-invite it with the link above).'
      );
    }
  }
  if (!ok) console.warn('⚠️ Slash commands are not registered — see the warnings above.');
}

async function handleChatInput(interaction) {
  switch (interaction.commandName) {
    case 'help':
      return interaction.reply({ embeds: [helpEmbed()] });
    case 'orders':
      return runOrders(interaction);
    case 'support':
      return runSupport(interaction);
    default:
      return runStaffSlash(interaction); // staff/admin bridge — no-op when unknown
  }
}

module.exports = {
  registerSlashCommands,
  handleChatInput,
  handleOrdersButton,
  handleSupportButton,
  helpEmbed,
  supportEmbed,
};
