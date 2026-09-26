'use strict';

const { brand, COLORS, DOT, e, heroLines, quote, section } = require('../utils/embeds');
const { getSetting, setSetting } = require('../database/db');
const { postPanel } = require('../shop/panel');

module.exports = [
  {
    name: 'help',
    level: 'public',
    usage: '!help',
    run: async (message) => {
      const { isStaff } = require('../utils/perms');
      const embed = brand(COLORS.black)
        .setTitle(`${e('shop')}  X SHOP — HOW TO ORDER`)
        .setDescription(
          [
            ...heroLines('Fast • Secure • Simple — seven steps and it is yours.'),
            quote(`${e('diamond')} Instant delivery  ${DOT}  ${e('card')} Secure payment  ${DOT}  ${e('staff')} Live support`),
            '',
            section(`${e('cart')}  Place an order`),
            ...[
              `**1.** Type \`buy\` in the shop channel`,
              `**2.** Pick a category, then a product`,
              `**3.** Press **Buy Now** — a private ticket opens for you`,
              `**4.** Choose quantity, answer the order questions`,
              `**5.** Pick a payment method (UPI / BTC / Crypto)`,
              `**6.** Pay, then upload your payment screenshot in the ticket`,
              `**7.** Staff verify the payment and deliver`,
            ].map(quote),
            '',
            section(`${e('order')}  Track your order`),
            quote(`${e('pending')} **Pending** — order created, choose quantity`),
            quote(`${e('pending')} **Awaiting payment** — pay & upload proof`),
            quote(`${e('review')} **Payment review** — staff checking your proof`),
            quote(`${e('processing')} **Processing** — verified, preparing delivery`),
            quote(`${e('completed')} **Completed** — delivered. Enjoy!`),
            quote(`${e('cancelled')} **Cancelled**  ${DOT}  ${e('refunded')} **Refunded**`),
            '',
            section(`${e('star')}  Good to know`),
            quote(`Browsing is public — your purchase is private`),
            quote(`Only you can use the Buy button in your session`),
            quote(`Cooldowns apply between orders (anti-spam)`),
            quote(`Need help? Open a ticket or ping staff`),
            ...(isStaff(message.member)
              ? ['', section(`${e('staff')}  Staff console`), quote('Type `!xhelp` for every staff & admin command, grouped by section.')]
              : []),
          ].join('\n')
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'maintenance',
    level: 'admin',
    usage: '!maintenance <on | off>',
    run: async (message, rest) => {
      const mode = rest.trim().toLowerCase();
      if (!['on', 'off'].includes(mode)) {
        return message.reply(`Usage: \`!maintenance on|off\` (currently: ${getSetting('maintenance') === '1' ? `${e('warning')} ON` : `${e('completed')} OFF`})`);
      }
      setSetting('maintenance', mode === 'on' ? '1' : '0');
      await message.reply(
        mode === 'on'
          ? `${e('warning')} Maintenance mode **enabled** — buying is disabled.`
          : `${e('completed')} Maintenance mode **disabled** — the shop is open.`
      );
    },
  },
  {
    name: 'doctor',
    level: 'admin',
    usage: '!doctor  (live permission & setup report)',
    run: async (message) => {
      const guild = message.guild;
      const { PermissionFlagsBits } = require('discord.js');
      const config = require('../config/config');
      const methods = require('../payments/methods');
      const { heroLines, quote } = require('../utils/embeds');
      const me = guild.members.me;

      const rows = [];
      const mark = (ok) => (ok ? e('completed') : e('cancelled'));
      const check = (name, ok, detail) => rows.push(`${mark(ok)} **${name}** — ${detail}`);

      // 1. Bot-wide permissions that tickets depend on.
      const needs = [
        ['Manage Channels', PermissionFlagsBits.ManageChannels],
        ['View Channel', PermissionFlagsBits.ViewChannel],
        ['Send Messages', PermissionFlagsBits.SendMessages],
        ['Embed Links', PermissionFlagsBits.EmbedLinks],
        ['Attach Files', PermissionFlagsBits.AttachFiles],
      ];
      for (const [label, perm] of needs) {
        check(label, me.permissions.has(perm), me.permissions.has(perm) ? 'ok' : 'MISSING on the bot role');
      }

      // 2. Shop channel.
      const shop = config.shopChannelId ? guild.channels.cache.get(config.shopChannelId) : null;
      const shopPerms = shop?.permissionsFor(me);
      check(
        'Shop channel',
        Boolean(shop && shopPerms?.has(PermissionFlagsBits.SendMessages)),
        shop ? `<#${shop.id}>` : 'SHOP_CHANNEL_ID not found in this guild'
      );

      // 3. Ticket category.
      const cat = config.orderCategoryId ? guild.channels.cache.get(config.orderCategoryId) : null;
      check(
        'Ticket category',
        Boolean(!config.orderCategoryId || cat),
        cat
          ? `<#${cat.id}> — tickets are created here`
          : config.orderCategoryId
            ? 'ORDER_CATEGORY_ID is set but the category was not found'
            : 'not set — tickets are created at the top level'
      );

      // 4. Staff role.
      const staffRole = config.staffRoleId ? guild.roles.cache.get(config.staffRoleId) : null;
      check(
        'Staff role',
        Boolean(staffRole),
        staffRole ? `${staffRole} (${staffRole.id})` : `STAFF_ROLE_ID "${config.staffRoleId || 'empty'}" not found`
      );

      // 5. Owners + payments.
      check('Owners', config.ownerIds.length > 0, config.ownerIds.map((id) => `<@${id}>`).join(', '));
      const all = methods.listAll();
      const configured = all.filter((m) => methods.isConfigured(m));
      check('Payment methods', configured.length > 0, `${configured.length}/${all.length} configured`);

      // 6. THE LIVE TEST — can the bot actually open + post in a ticket right now?
      let live = '';
      try {
        const test = await guild.channels.create({
          name: `doctor-test-${Date.now().toString(36).slice(-4)}`,
          type: require('discord.js').ChannelType.GuildText,
          parent: config.orderCategoryId || null,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
          ],
          reason: 'X SHOP !doctor live ticket test',
        });
        try {
          await test.send({ content: '✦ !doctor live test — this channel deletes itself.' });
          live = `${e('completed')} tickets can be created and posted in`;
        } catch (err) {
          live = `${e('cancelled')} created the channel but could NOT post: ${err.code || ''} ${err.message}`;
        }
        await test.delete('X SHOP !doctor live test done').catch(() => {});
      } catch (err) {
        live = `${e('cancelled')} could not create a test channel: ${err.code || ''} ${err.message}`;
      }
      rows.push(`${e('ticket')} **Live ticket test** — ${live}`);

      const embed = brand(COLORS.warning)
        .setTitle(`${e('staff')} X SHOP — Doctor`)
        .setDescription(
          [
            ...heroLines('Live permission & setup report.'),
            ...rows,
            '',
            quote(`${e('sparkle')} *If any row is red, fix it with the hint on the right / in the error log.*`),
          ].join('\n')
        )
        .setTimestamp();
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'panel',
    level: 'admin',
    usage: '!panel [channelId]',
    run: async (message, rest) => {
      const channelId = rest.trim() || message.channel.id;
      const channel = await message.guild.channels.fetch(channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) return message.reply(`${e('warning')} Channel not found.`);
      const msg = await postPanel(channel);
      if (msg) {
        await message.reply(`${e('completed')} X SHOP panel posted in ${channel}.`);
      }
    },
  },
  {
    name: 'buysetup',
    level: 'admin',
    usage: '!buysetup [#channel]',
    run: async (message, rest) => {
      // Post the ticket-flavour buy menu in this (or a named) channel: choosing
      // a category opens the customer's ticket right away, and the product is
      // picked inside the ticket. The classic `buy` panel is untouched.
      let channel = message.channel;
      const arg = rest.trim();
      if (arg) {
        const id = arg.replace(/<#|>/g, '').trim();
        channel = await message.guild.channels.fetch(id).catch(() => null);
        if (!channel || !channel.isTextBased()) {
          return message.reply(`${e('warning')} Channel not found — mention it like \`!buysetup #shop\`.`);
        }
      }
      const msg = await postPanel(channel, true);
      if (msg) {
        await message.reply(
          `${e('completed')} Buy menu is live in ${channel}. Anyone who picks a category gets a private ticket instantly.`
        );
      }
    },
  },
  {
    name: 'xhelp',
    level: 'staff',
    usage: '!xhelp',
    run: async (message) => {
      const { isAdmin } = require('../utils/perms');
      const xhelp = require('./xhelp');
      await message.reply(xhelp.overviewView(isAdmin(message.member)));
    },
  },
  {
    name: 'ping',
    level: 'staff',
    usage: '!ping',
    run: async (message) => {
      const sent = await message.reply(`${e('bell')} Pinging…`);
      const ws = message.client.ws.ping;
      await sent.edit(`${e('bell')} Pong! WebSocket: \`${ws >= 0 ? `${ws}ms` : 'n/a'}\``);
    },
  },
  {
    name: 'setbanner',
    level: 'admin',
    usage: '!setbanner <image-url>  (or attach an image — use "off" to remove)',
    run: async (message, rest) => {
      return setShopImage(message, rest, 'shop_banner', 'banner');
    },
  },
  {
    name: 'setlogo',
    level: 'admin',
    usage: '!setlogo <image-url>  (or attach an image — use "off" to remove)',
    run: async (message, rest) => {
      return setShopImage(message, rest, 'shop_logo', 'logo');
    },
  },
];

/** Shared by !setbanner / !setlogo — stores a panel image in settings. */
async function setShopImage(message, rest, key, label) {
  const arg = rest.trim();
  const isImage = (a) => a.contentType && a.contentType.startsWith('image/');
  let url = arg;
  const attachment = message.attachments.find(isImage);
  if (attachment) url = attachment.url;
  if (/^(off|none|remove)$/i.test(url)) {
    setSetting(key, '');
    return message.reply(`${e('cancelled')} Shop ${label} removed — panels render text-only.`);
  }
  if (!url || !/^https?:\/\//i.test(url)) {
    return message.reply(`Usage: \`!set${label} <image-url>\` — or attach an image to this command.`);
  }
  setSetting(key, url);
  await message.reply(`${e('completed')} Shop ${label} saved — it now appears on the main shop panel.`);
}
