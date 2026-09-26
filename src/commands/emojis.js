'use strict';

const {
  brand,
  COLORS,
  EMOJI_KEYS,
  emojiReport,
  setEmojiValue,
  setEmojiClient,
  keyForEmojiName,
  validEmojiValue,
  e,
  lead,
} = require('../utils/embeds');

/** Key names shown to admins (custom emoji names can be any of these). */
const ALIASES = {
  shop: 'xshop / brand / star mark',
  cart: 'buy now button + product pages',
  nitro: 'Nitro products & menu',
  gaming: 'Gaming category',
  entertainment: 'Entertainment category',
  social: 'Social category',
  more: 'More category / select menus',
  boost: 'Server boosts',
  gift: 'Gift links',
  id: 'Nitro IDs',
  card: 'VCC / payment lines',
  promo: 'Promo products',
  deco: 'Decoration products',
  cash: 'total / amount lines',
  money: 'price lines',
  crypto: 'Crypto (USDT)',
  bitcoin: 'Bitcoin',
  upi: 'UPI payments',
  ticket: 'ticket + order links',
  order: 'order id lines',
  pending: 'pending status',
  review: 'payment review status',
  processing: 'processing status',
  completed: 'completed status',
  cancelled: 'cancelled status',
  refunded: 'refunded status',
  staff: 'staff actions',
  delivery: 'delivery / stock',
  stock: 'stock lines',
  star: 'highlights',
  crown: 'banner headers',
  diamond: 'premium marks',
  fire: 'hot deals',
  sparkle: 'premium accents',
  heart: 'X SHOP love',
  bell: 'new order notifications',
};

/** Custom emojis of this guild, sorted, used for the `#index` shortcut. */
function serverEmojis(guild) {
  if (!guild || !guild.emojis) return [];
  return [...guild.emojis.cache.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ge) => ({ name: ge.name, mention: ge.toString(), key: keyForEmojiName(ge.name) }));
}

/** Truncate a description so it never exceeds Discord's 4096 char limit. */
function clip(lines, max = 4000) {
  const out = [];
  let size = 0;
  for (const line of lines) {
    if (size + line.length + 1 > max) {
      out.push('_…list truncated — see the web dashboard for everything._');
      break;
    }
    out.push(line);
    size += line.length + 1;
  }
  return out.join('\n');
}

/**
 * Understand every way an admin might hand us an emoji:
 * `#3` (index from !emojiscan) · `:name:` · `<:name:id>` · `<a:name:id>` · raw unicode.
 */
function resolveEmojiInput(input, guild) {
  const text = String(input || '').trim();
  if (!text) return { error: 'No emoji given.' };

  const list = serverEmojis(guild);
  const byIndex = text.match(/^#(\d{1,3})$/);
  if (byIndex) {
    const pick = list[Number(byIndex[1]) - 1];
    if (!pick) {
      return {
        error: `\`${text}\` is out of range — your server has ${list.length} custom emoji(s). Run \`!emojiscan\`.`,
      };
    }
    return { value: pick.mention };
  }

  const byName = text.match(/^:([a-zA-Z0-9_]{2,32}):$/);
  if (byName) {
    const pick = list.find((ge) => ge.name.toLowerCase() === byName[1].toLowerCase());
    if (pick) return { value: pick.mention };
    return {
      error:
        `\`:${byName[1]}:\` is **not a custom server emoji**. Discord's built-in emojis ` +
        '(`:boost:`, `:nitro:`, …) only exist inside the Discord client — bots cannot use them. ' +
        `Upload your own emoji named \`${byName[1]}\` (Server Settings → Emoji) and it is picked up automatically, ` +
        'or pass the emoji directly.',
    };
  }

  if (/^<a?:\w{2,32}:\d{17,19}>$/.test(text)) return { value: text };

  if (validEmojiValue(text)) return { value: text };

  return {
    error:
      'That is not a usable emoji. Pass a real emoji, a custom one (`<:name:id>` — right-click in Discord → *Copy Link*), ' +
      '`:name:` of one of your server emojis, or `#index` from `!emojiscan`.',
  };
}

module.exports = [
  {
    name: 'setemoji',
    level: 'admin',
    usage: '!setemoji <key> <emoji>   (see keys with !emojis)',
    run: async (message, rest) => {
      const parts = rest.trim().split(/\s+/);
      const key = (parts.shift() || '').toLowerCase();
      const emoji = parts.join(' ').trim();
      if (!key || !emoji) {
        return message.reply(
          `Usage: \`!setemoji <key> <emoji>\` — valid keys: \`${EMOJI_KEYS.join(', ')}\`\n` +
            'Tip: type `\\:yourEmoji:` or paste the emoji directly.'
        );
      }
      if (!EMOJI_KEYS.includes(key)) {
        return message.reply(
          `${e('warning')} Unknown key \`${key}\`. Valid keys: \`${EMOJI_KEYS.join(', ')}\``
        );
      }

      let value = null;

      const resolved = resolveEmojiInput(emoji, message.guild);
      if (resolved.error) return message.reply(`${e('warning')} ${resolved.error}`);
      value = resolved.value;

      const result = setEmojiValue(key, value);
      if (!result.ok) return message.reply(`${e('warning')} ${result.error}`);

      await message.reply(
        `✦ **${key}** → ${result.value} everywhere (${ALIASES[key] || 'UI'}). Source: ${result.source}.`
      );
    },
  },
  {
    name: 'resetemoji',
    level: 'admin',
    usage: '!resetemoji <key>',
    run: async (message, rest) => {
      const key = rest.trim().toLowerCase();
      if (!EMOJI_KEYS.includes(key)) {
        return message.reply(`Valid keys: \`${EMOJI_KEYS.join(', ')}\``);
      }
      const result = setEmojiValue(key, '');
      if (!result.ok) return message.reply(`${e('warning')} ${result.error}`);
      await message.reply(`**${key}** reset — now ${result.value} (${result.source}).`);
    },
  },
  {
    name: 'emojis',
    level: 'staff',
    usage: '!emojis',
    run: async (message) => {
      const report = emojiReport();
      const custom = report.filter((r) => r.source !== 'unicode fallback').length;
      const list = serverEmojis(message.guild);
      const lines = [
        `**${custom}/${report.length} keys use a custom emoji** — the rest use clean unicode fallbacks.`,
        '',
        ...report.map(
          (r) =>
            `${r.value} \`${r.key}\` — ${r.source}${r.overridden ? ` ${e('star')}` : ''}` +
            `${ALIASES[r.key] ? ` • ${ALIASES[r.key]}` : ''}`
        ),
        '',
        '**Style it:** `!setemoji <key> <emoji>` · `!resetemoji <key>` · `!autoemojis` (re-scan)',
        'Visual studio: **web dashboard → Emojis** (hint: `!emojiscan` lists your server emojis).',
      ];
      if (list.length) {
        lines.push(
          '',
          `**Your server emojis (${list.length})** — apply with \`!setemoji <key> #index\`:`,
          ...list
            .slice(0, 40)
            .map(
              (ge, i) =>
                `\`#${i + 1}\` ${ge.mention} \`${ge.name}\`${ge.key ? ` → **${ge.key}**` : ''}`
            )
        );
      }
      const embed = brand(COLORS.dark)
        .setTitle('✦ X SHOP — EMOJI STUDIO')
        .setDescription(clip(lines));
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'emojiscan',
    level: 'staff',
    usage: '!emojiscan',
    run: async (message) => {
      const list = serverEmojis(message.guild);
      if (!list.length) {
        return message.reply(
          `${e('warning')} No custom emojis in this server yet. Upload them in **Server Settings → Emoji** — names like ` +
            '`nitro`, `x_nitro`, `xcart` or `gift_icon` are matched automatically.'
        );
      }
      const matched = list.filter((ge) => ge.key);
      const embed = brand(COLORS.violet)
        .setTitle('✦ X SHOP — SERVER EMOJI SCAN')
        .setDescription(
          clip([
            `Found **${list.length}** custom emoji(s) — **${matched.length}** auto-matched to UI keys.`,
            'Assign any of them with `!setemoji <key> #index`.',
            '',
            ...list
              .slice(0, 60)
              .map(
                (ge, i) =>
                  `\`#${i + 1}\` ${ge.mention} \`${ge.name}\`${ge.key ? ` → **${ge.key}**` : ' → _unmatched_'}`
              ),
          ])
        );
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'autoemojis',
    level: 'admin',
    usage: '!autoemojis',
    run: async (message) => {
      const matched = setEmojiClient(message.client);
      await message.reply(
        `✦ Re-scanned server emojis — **${matched}** UI key(s) now use your custom emojis. Check \`!emojis\`.`
      );
    },
  },
  {
    name: 'addemoji',
    level: 'admin',
    usage:
      '!addemoji <name> — attach an image (or reply to one), or pass an image URL: !addemoji nitro https://…/nitro.png',
    run: async (message, rest) => {
      if (!message.guild) return message.reply(`${e('warning')} Use this inside a server.`);

      const parts = rest.trim().split(/\s+/).filter(Boolean);
      const name = (parts.shift() || '').trim();
      const urlArg = parts.join(' ').trim();

      // Name rules: 2-32 chars, letters/digits/underscore (Discord requirement).
      if (!/^[\w]{2,32}$/.test(name)) {
        return message.reply(
          lead(e('warning'), 'Invalid name — use 2–32 letters, numbers or underscores, e.g. `!addemoji x_nitro`.')
        );
      }
      if (message.guild.emojis.cache.some((em) => em.name.toLowerCase() === name.toLowerCase())) {
        return message.reply(`${e('warning')} An emoji named \`${name}\` already exists in this server.`);
      }

      // Image source: attachment on this message → URL argument → replied message.
      const isImage = (a) => a.contentType && /image\/(png|jpeg|jpg|gif|webp)/.test(a.contentType);
      let source = '';
      const ownAttachment = message.attachments.find(isImage);
      if (ownAttachment) source = ownAttachment.url;
      if (!source && urlArg) source = urlArg;
      if (!source && message.reference?.messageId) {
        try {
          const replied = await message.channel.messages.fetch(message.reference.messageId);
          const repliedImg = replied.attachments.find(isImage);
          if (repliedImg) source = repliedImg.url;
        } catch {
          /* reply message unavailable */
        }
      }
      if (!source) {
        return message.reply(
          `${e('warning')} No image found — **attach an image** to this command, reply to a message with an image, or pass a URL.`
        );
      }

      const notice = await message.reply(`${e('pending')} Uploading \`${name}\`…`);
      try {
        const res = await fetch(source);
        if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length > 256 * 1024) {
          return notice.edit(`${e('warning')} Image is larger than **256 KB** — Discord rejects emoji uploads that big.`);
        }
        const emoji = await message.guild.emojis.create({ attachment: buffer, name });
        const key = keyForEmojiName(emoji.name);
        // The GuildEmojiCreate listener re-scans automatically; report the match.
        await notice.edit(
          `${e('completed')} Added ${emoji} \`:${emoji.name}:\`` +
            (key
              ? ` — auto-matched to the **${key}** UI slot and now used everywhere.`
              : '. Name it like a UI key (e.g. `nitro`, `xcart`) to auto-use it, or bind with `!setemoji`.') +
            '\nRun `!autoemojis` if it is not applied yet.'
        );
      } catch (err) {
        const hint = /Missing Permissions|MANAGE_GUILD_EXPRESSIONS/i.test(String(err))
          ? ' — the bot needs the **Manage Expressions** permission.'
          : /maximum|limit|slots/i.test(String(err))
            ? ' — this server is out of emoji slots.'
            : '';
        await notice.edit(`${e('warning')} Could not add the emoji: ${err.message || err}${hint}`);
      }
    },
  },
  {
    name: 'delemoji',
    level: 'admin',
    usage: '!delemoji <name>',
    run: async (message, rest) => {
      if (!message.guild) return message.reply(`${e('warning')} Use this inside a server.`);
      const name = rest.trim().replace(/^:|:$/g, '');
      if (!name) return message.reply('Usage: `!delemoji <name>`');
      const emoji = message.guild.emojis.cache.find((em) => em.name.toLowerCase() === name.toLowerCase());
      if (!emoji) return message.reply(`${e('warning')} No emoji named \`${name}\` in this server.`);
      try {
        await emoji.delete();
        await message.reply(`${e('cancelled')} Deleted \`:${emoji.name}:\` — fallback emoji are used until you re-scan.`);
      } catch (err) {
        await message.reply(`${e('warning')} Could not delete the emoji: ${err.message || err}`);
      }
    },
  },
];
