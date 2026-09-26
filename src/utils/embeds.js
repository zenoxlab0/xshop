'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
let APPLICATION_EMOJIS = {};
try {
  APPLICATION_EMOJIS = require('./applicationEmojis.json');
} catch {
  APPLICATION_EMOJIS = {};
}

/**
 * UI key -> custom emoji uploaded to THIS application (uiEmojis.json).
 * These are the ones the shop actually renders; they always win over the
 * legacy defaults below and over the old source-key mapping.
 */
let UI_EMOJIS = {};
try {
  UI_EMOJIS = require('./uiEmojis.json');
} catch {
  UI_EMOJIS = {};
}

const COLORS = {
  primary: 0x111111, // Near-black
  violet: 0x181818, // Soft black
  lavender: 0x242424,
  dark: 0x0b0b0b,
  black: 0x050505,
  success: 0x22c55e,
  danger: 0xef4444,
  warning: 0xf59e0b,
  info: 0x38bdf8,
  muted: 0x64748b,
};

const FOOTER = 'X SHOP • Premium Digital Marketplace';
const DIV = '──────────────────────────';
const DIV_SOFT = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
const BULLET = '❯';
const DOT = '•';

// ── Premium presentation kit ────────────────────────────────────────────────

/**
 * Plain-text-safe string. Discord renders select-menu placeholders, select
 * option labels, button labels and modal field labels/placeholders as PLAIN
 * TEXT — a custom-emoji tag like `<:MekoFastMessage:123…>` is shown literally
 * there (that is exactly how it leaked into "Choose your payment method…").
 * Everything headed for those fields goes through here.
 */
function plain(value) {
  return String(value ?? '')
    .replace(/<a?:\w{2,32}:\d{17,20}>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `▰▰▰▰▱▱▱ 4/7` — compact premium progress bar. */
function progressBar(done, total, width = 7) {
  const t = Math.max(1, Number(total) || 1);
  const d = Math.min(Math.max(0, Math.round(Number(done) || 0)), t);
  const filled = Math.round((d / t) * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, width - filled))}  \`${d}/${t}\``;
}

/** Fixed-width label/value row that lines up inside embeds. */
function kv(label, value) {
  return `${String(label).padEnd(12)} ${BULLET} ${value}`;
}

/** Section heading used inside embed descriptions. */
function section(label) {
  // Uppercase the label but leave custom-emoji mentions (<a:name:id>) intact —
  // uppercasing the `a:` flag or name breaks the mention and renders raw text.
  const upper = String(label)
    .split(/(<a?:[a-zA-Z0-9_]+:\d+>)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.toUpperCase()))
    .join('');
  return `**${upper}**`;
}

/**
 * The premium hero block every screen starts with — everything stacks line
 * wise, and the secondary line is a grey `>` quote instead of a rule:
 *   ✦ **X SHOP** • *Premium Digital Marketplace*
 *   > subtitle
 */
function heroLines(subtitle = '') {
  return [
    `${e('sparkle')} **X SHOP** ${DOT} *Premium Digital Marketplace*`,
    subtitle ? quote(subtitle) : '',
  ].filter(Boolean);
}

/**
 * `> text` — a grey blockquote line. Every secondary/meta row in the UI is a
 * quote line rather than a horizontal field, so screens read top to bottom.
 */
function quote(text) {
  return `> ${String(text ?? '').trim()}`;
}

/**
 * `emoji  text`, or just `text` when there is no emoji. Resolvers are allowed
 * to return '' (no Discord-default emoji anywhere) — without this every title
 * would keep the two separator spaces and start with a gap.
 */
function lead(emoji, text) {
  const s = String(emoji ?? '').trim();
  return s ? `${s}  ${text}` : String(text ?? '');
}

/**
 * Custom emoji resolver. Server admins can upload custom emojis named exactly
 * like the keys below; whenever present in a server the bot uses them, with a
 * graceful unicode fallback. Emojis are cached per-guild on first use.
 */
const EMOJI_FALLBACKS = {
  // Application emoji defaults, synced by scripts/sync-application-emojis.js
  // from src/utils/sourceEmojis.json. These IDs are this application's OWN
  // emojis (re-run `npm run sync-emojis` and restart if they ever change).
  shop: '<:MekoUtility:1551781768477151342>',
  cart: '<:MekoGift:1551781870445010965>',
  buy: '<:MekoGift:1551781870445010965>',
  nitro: '<:MekoRuby:1551781807844888707>',
  gaming: '<:MekoFun:1551781837116809289>',
  entertainment: '<:MekoActivity:1551781812735442984>',
  social: '<:features_icons:1551781776609910865>',
  more: '<:MekoAttachment:1551781849070706807>',
  boost: '<:icon_booster:1551781817772810271>',
  gift: '<:MekoGift:1551781870445010965>',
  id: '<:MekoInvite:1551781883753406544>',
  card: '<:MekoFastMessage:1551781841235873834>',
  promo: '<:MekoRuby:1551781807844888707>',
  deco: '<:features_icons:1551781776609910865>',
  cash: '<:MekoStatusRole:1551781830137487450>',
  money: '<:MekoStatusRole:1551781830137487450>',
  crypto: '<:MekoRuby:1551781807844888707>',
  bitcoin: '<:MekoRuby:1551781807844888707>',
  upi: '<:MekoFastMessage:1551781841235873834>',
  ticket: '<:MekoTicket:1551781874802626620>',
  order: '<:MekoAttachment:1551781849070706807>',
  pending: '<:MekoActivity:1551781812735442984>',
  review: '<:MekoStatusRole:1551781830137487450>',
  processing: '<:MekoDeveloper:1551781791575314563>',
  completed: '<:MekoGreet:1551781801809158286>',
  cancelled: '<:MekoMod:1551781764228452443>',
  refunded: '<:MekoUnmute:1551781879504703559>',
  staff: '<:MekoMod:1551781764228452443>',
  admin: '<:MekoMod:1551781764228452443>',
  delivery: '<:MekoAttachment:1551781849070706807>',
  stock: '<:MekoServer:1551781825695977572>',
  star: '<:NexusStarboard:1551781860026355795>',
  crown: '<:MekoGreet:1551781801809158286>',
  diamond: '<:NexusStarboard:1551781860026355795>',
  fire: '<:MekoFun:1551781837116809289>',
  sparkle: '<:features_icons:1551781776609910865>',
  heart: '<:MekoGreet:1551781801809158286>',
  bell: '<:MekoInvite:1551781883753406544>',
  // Directional + status glyphs added for the line-wise restyle. They replace
  // the hard-coded Discord unicode (➡️ ⚠️ 🔒 ℹ️) that used to sit in pagination
  // buttons, validation replies and info titles.
  arrow: '<:arrowright:1551986185566421043>',
  back: '<a:dl_g_arrow:1551986581135560825>',
  warning: '<a:warningbug:1551987977067176041>',
  lock: '<:lock:1551987086217977997>',
  info: '<:info1:1551986910153670770>',
};

// The curated pack (uiEmojis.json) is what the shop actually renders. Every
// key below is one of the emojis uploaded to THIS application, so it is usable
// in every guild the bot is in — unlike a server emoji, which only works in
// the guild it belongs to. Overlaying it here means a fresh install and a
// fresh `npm run sync-emojis` can never silently regress to the old set.
for (const [key, value] of Object.entries(UI_EMOJIS)) {
  if (value && Object.prototype.hasOwnProperty.call(EMOJI_FALLBACKS, key)) {
    EMOJI_FALLBACKS[key] = value;
  }
}

/** True for a `<:name:id>` / `<a:name:id>` tag Discord can resolve. */
const CUSTOM_TAG = /^<a?:\w{2,32}:\d{17,20}>$/;

/** Pull the id out of a custom emoji tag (null when it is not one). */
function tagId(value) {
  const m = CUSTOM_TAG.exec(String(value || '').trim());
  return m ? String(value).trim().match(/:(\d{17,20})>$/)[1] : null;
}

/**
 * Resolution order for every UI emoji key:
 *   1. admin override stored in `settings` (`!setemoji` / dashboard)
 *   2. curated application emoji (uiEmojis.json) — always usable, every guild
 *   3. auto-matched **server custom emoji** (fuzzy name match) or the legacy
 *      synced set (applicationEmojis.json via APP_EMOJI_ALIASES)
 *   4. built-in custom-emoji fallback (this application's own emojis)
 * Nothing but real custom emojis is cached, so a late guild scan or a manual
 * override always wins — stale fallbacks can never stick.
 */
const customEmojiCache = new Map(); // key -> custom emoji scanned from the guilds

/**
 * UI key -> key inside applicationEmojis.json (written by the emoji sync
 * script). The synced emojis are stored under their source keys (`utility`,
 * `permit`, `games`, ...); this maps them onto the keys the UI asks for
 * (`shop`, `card`, `gaming`, ...).
 */
const APP_EMOJI_ALIASES = {
  shop: 'utility',
  cart: 'giveaway',
  buy: 'giveaway',
  gift: 'giveaway',
  nitro: 'reactionrole',
  promo: 'reactionrole',
  crypto: 'reactionrole',
  bitcoin: 'reactionrole',
  gaming: 'games',
  fire: 'games',
  entertainment: 'sticky',
  pending: 'sticky',
  social: 'general',
  deco: 'general',
  sparkle: 'general',
  more: 'server',
  order: 'server',
  delivery: 'server',
  boost: 'booster',
  id: 'invite',
  bell: 'invite',
  card: 'permit',
  upi: 'permit',
  money: 'fun',
  cash: 'fun',
  review: 'fun',
  processing: 'music',
  completed: 'customrole',
  crown: 'customrole',
  heart: 'customrole',
  cancelled: 'security',
  refunded: 'jointocreate',
  staff: 'security',
  admin: 'security',
  stock: 'verification',
  ticket: 'ticket',
  star: 'messages',
  diamond: 'messages',
};

function seedApplicationEmojis() {
  for (const [key, value] of Object.entries(APPLICATION_EMOJIS)) {
    if (value) customEmojiCache.set(key, value);
  }
  for (const [uiKey, appKey] of Object.entries(APP_EMOJI_ALIASES)) {
    const value = APPLICATION_EMOJIS[appKey];
    if (value) customEmojiCache.set(uiKey, value);
  }
}
seedApplicationEmojis();
const dbEmojiCache = new Map(); // key -> admin override from settings
const dbEmojiLoaded = new Set();

/** All emoji keys the UI understands (for !emojis / !setemoji / dashboard). */
const EMOJI_KEYS = Object.keys(EMOJI_FALLBACKS);

// Names such as `x_nitro`, `xs-cart`, `shopGift` or `boost_icon` still match.
const NAME_PREFIXES = ['xshop', 'shop', 'xs', 'x'];
const NAME_SUFFIXES = ['emoji', 'icon', 'image', 'img'];

/**
 * True when the value is a real usable emoji: a custom `<:name:id>` /
 * `<a:name:id>` mention, or a unicode emoji.
 *
 * NOTE: discord.js `parseEmoji()` returns an object for *any* string without a
 * colon (e.g. "not an emoji"), so it can never be used on its own — ASCII-only
 * text and plain words are rejected here explicitly.
 */
function validEmojiValue(value) {
  if (!value) return false;
  const v = String(value).trim();
  if (!v || v.length > 64) return false;
  if (/^<a?:\w{2,32}:\d{17,19}>$/.test(v)) return true; // custom server emoji
  if (/^[\x20-\x7e]+$/.test(v)) return false; // pure ASCII text is never an emoji
  if (/[a-zA-Z0-9]{2,}/.test(v)) return false; // sentences / names are not emojis
  if (!/[\p{Emoji}\u200d\ufe0f\u20e3]/u.test(v)) return false; // no pictographic char
  try {
    // eslint-disable-next-line global-require
    const { parseEmoji } = require('discord.js');
    return Boolean(parseEmoji(v));
  } catch {
    return false;
  }
}

/** `x_nitro` → `nitro` (alphanumeric only, lower-case). */
const normalizeEmojiName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Map a server emoji name onto a UI key, tolerating real-world naming:
 * `nitro`, `Nitro`, `x_nitro`, `xsnitro`, `shop-nitro`, `nitro_icon` → all `nitro`.
 * Returns null when the name does not describe any UI key.
 */
function keyForEmojiName(name) {
  const raw = String(name || '').toLowerCase();
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(EMOJI_FALLBACKS, raw)) return raw;
  const flat = normalizeEmojiName(raw);
  const variants = new Set([flat]);
  for (const p of NAME_PREFIXES) {
    if (flat.startsWith(p)) variants.add(flat.slice(p.length));
    if (flat.endsWith(p)) variants.add(flat.slice(0, -p.length));
  }
  for (const s of NAME_SUFFIXES) {
    if (flat.endsWith(s)) variants.add(flat.slice(0, -s.length));
  }
  for (const v of [...variants]) {
    for (const p of NAME_PREFIXES) {
      if (v.startsWith(p)) variants.add(v.slice(p.length));
      if (v.endsWith(p)) variants.add(v.slice(0, -v.length));
    }
  }
  for (const v of variants) {
    if (v && Object.prototype.hasOwnProperty.call(EMOJI_FALLBACKS, v)) return v;
  }
  return null;
}

/**
 * Label → UI key. Database rows still carry their original unicode emoji
 * (🚀 🎁 🪪 💳 …) and those must never reach a Discord surface any more, so the
 * icon for a category/product/payment row is now derived from its NAME:
 * `Nitro VCC` → nitro, `Netflix` → entertainment, `UPI 2` → upi.
 * Returns null when the label describes nothing in the pack (→ no emoji).
 */
const LABEL_KEYWORDS = [
  [/nitro/, 'nitro'],
  [/(^|\W)boost/, 'boost'],
  [/robux|roblox|free\s*fire|mobile\s*legends|games?|gaming/, 'gaming'],
  [/netflix|spotify|youtube|prime video|hulu|disney|music|movies?/, 'entertainment'],
  [/instagram|twitter|tiktok|social|followers/, 'social'],
  [/(^|\W)vcc|(^|\W)card|credit|debit/, 'card'],
  [/(^|\W)upi|\bgpay\b|phonepe|paytm/, 'upi'],
  [/bit\s*coin|\bbtc\b/, 'bitcoin'],
  [/usdt|crypto|trc20|erc20/, 'crypto'],
  [/promo|coupon|discount|offers?/, 'promo'],
  [/deco/, 'deco'],
  [/custom/, 'diamond'],
  [/coming\s*soon/, 'pending'],
  [/stock|quantit|(^|\W)qty/, 'stock'],
  [/tickets?|support|help/, 'ticket'],
  [/orders?|clipboard/, 'order'],
  [/(^|\W)vip|crown/, 'crown'],
  [/gems?|diamonds?/, 'diamond'],
  [/flames?|(^|\W)fire/, 'fire'],
  [/hearts?|(^|\W)love/, 'heart'],
  [/bells?|pings?|notifs?/, 'bell'],
  [/stars?|ratings?/, 'star'],
  [/services?|products?|stores?|more/, 'more'],
];

function keyForLabel(label) {
  const raw = String(label || '').toLowerCase();
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(EMOJI_FALLBACKS, raw)) return raw;
  for (const [pattern, key] of LABEL_KEYWORDS) if (pattern.test(raw)) return key;
  return null;
}

/** Admin override for a key (lazy DB read, validated, cached in memory). */
function dbEmoji(key) {
  if (!dbEmojiLoaded.has(key)) {
    dbEmojiLoaded.add(key);
    try {
      const stored = require('../database/db').getSetting(`emoji:${key}`);
      if (stored && validEmojiValue(stored)) dbEmojiCache.set(key, String(stored).trim());
      else dbEmojiCache.delete(key);
    } catch {
      dbEmojiLoaded.delete(key); // database not ready yet — retry next call
    }
  }
  return dbEmojiCache.get(key) || null;
}

/** Resolve a UI emoji key (or a raw emoji string) for use in messages. */
function e(name) {
  if (!name) return '';
  const key = String(name).toLowerCase();
  // Curated pack (#2) is checked before the scan cache (#3) so a fuzzy server
  // match like `xs-star` can never shadow an emoji picked deliberately.
  return dbEmoji(key) || UI_EMOJIS[key] || customEmojiCache.get(key) || EMOJI_FALLBACKS[key] || '✦';
}

/** Where a key's current emoji comes from — surfaced by !emojis + dashboard. */
function emojiSource(key) {
  const k = String(key).toLowerCase();
  if (dbEmoji(k)) return 'override (!setemoji / dashboard)';
  if (UI_EMOJIS[k]) return 'curated application emoji (uiEmojis.json)';
  if (customEmojiCache.has(k)) return 'auto-matched server emoji';
  if (EMOJI_FALLBACKS[k]) return 'application emoji';
  return 'unicode fallback';
}

/** Full key/key/value/source table used by !emojis and the web dashboard. */
function emojiReport() {
  return EMOJI_KEYS.map((key) => ({
    key,
    value: e(key),
    fallback: EMOJI_FALLBACKS[key] || '✦',
    source: emojiSource(key),
    overridden: Boolean(dbEmoji(key)),
  }));
}

/** Store (or clear, with an empty value) an admin override. Invalid → error. */
function setEmojiValue(key, value) {
  const k = String(key || '').toLowerCase();
  if (!EMOJI_KEYS.includes(k)) return { ok: false, error: `unknown key "${key}"` };
  const v = value === null || value === undefined || String(value).trim() === ''
    ? ''
    : String(value).trim();
  if (v && !validEmojiValue(v)) {
    return { ok: false, error: `"${v}" is not a real emoji (try a custom emoji or a unicode emoji)` };
  }
  try {
    const dbm = require('../database/db');
    if (v) dbm.setSetting(`emoji:${k}`, v);
    else dbm.deleteSetting(`emoji:${k}`); // reset → drop the row instead of storing ''
  } catch {
    return { ok: false, error: 'database not available' };
  }
  dbEmojiLoaded.add(k);
  if (v) dbEmojiCache.set(k, v);
  else dbEmojiCache.delete(k);
  return { ok: true, value: e(k), source: emojiSource(k) };
}

/** Drop every cached resolution (used when the whole mapping is rewritten). */
function clearEmojiCache() {
  customEmojiCache.clear();
  dbEmojiCache.clear();
  dbEmojiLoaded.clear();
}

/** True only for a real custom-emoji tag (`<:name:id>` / `<a:name:id>`). */
function customTag(value) {
  const s = String(value || '').trim();
  return Boolean(s.startsWith('<') && tagId(s));
}

/**
 * Emoji for a LABEL (category / product / payment-method name): admin override
 * → curated pack → auto-matched server emoji → fuzzy match on the label text →
 * the row's own emoji, but only when it is already a custom tag.
 *
 * Never returns a Discord-default emoji: seeded rows carry 🚀 🎁 🪪 💳 and
 * those are exactly what the redesign removes. Pair with lead() so an empty
 * result does not leave a gap in the title.
 */
function eMaybe(name, fallback) {
  const key = String(name || '').toLowerCase();
  const custom = dbEmoji(key) || UI_EMOJIS[key] || customEmojiCache.get(key);
  if (custom) return custom;

  const matched = keyForLabel(name);
  if (matched && matched !== key) {
    const byLabel = dbEmoji(matched) || UI_EMOJIS[matched] || customEmojiCache.get(matched) || EMOJI_FALLBACKS[matched];
    if (byLabel) return byLabel;
  }
  if (customTag(fallback)) return String(fallback).trim();
  return EMOJI_FALLBACKS[key] || '';
}

// ── Component-emoji safety ─────────────────────────────────────────────────
// A custom emoji may only be emitted in a message component (button emoji,
// select option emoji) if the bot can actually ACCESS it: it must belong to a
// guild the bot is in, or to this application's own synced emoji collection.
// A stale id (e.g. synced by a previous application) makes Discord reject the
// whole message with COMPONENT_INVALID_EMOJI — that is the crash this fixes.
let guildEmojiIds = new Set(); // ids of every custom emoji in the bot's guilds
let appEmojiIds = new Set();   // ids of this application's own emojis

/** True when the bot can use this custom emoji in a message/component. */
function emojiUsable(id) {
  const s = String(id || '');
  return /^\d{17,20}$/.test(s) && (guildEmojiIds.has(s) || appEmojiIds.has(s));
}

/** Fetch this application's own emojis so synced ids become usable. */
async function loadAppEmojis(client) {
  if (!client) return 0;
  try {
    const emojis = await client.application?.emojis?.fetch?.();
    const next = new Set();
    for (const emoji of emojis?.values?.() ?? []) next.add(emoji.id);
    if (next.size) appEmojiIds = next;
    return next.size;
  } catch {
    return 0; // app emoji fetch failed — guild emojis still usable
  }
}

// Curated ids were verified present on this application at build time, so they
// are trusted as usable even before loadAppEmojis() resolves — otherwise the
// shop would flash unicode fallbacks for a few seconds after every boot.
const CURATED_IDS = new Set(Object.values(UI_EMOJIS).map(tagId).filter(Boolean));

/** True when a custom emoji id is safe to emit in a component. */
function componentUsable(id) {
  return emojiUsable(id) || CURATED_IDS.has(id);
}

/**
 * Component-safe emoji for buttons/select-menu options — CUSTOM EMOJI ONLY.
 * Discord REJECTS plain text symbols (✦ ₿ ─) and this design rejects
 * Discord-default emoji in components too, so unicode (row emoji, ⭐) is never
 * returned. Returns a usable `<:name:id>` tag, or undefined meaning "no emoji":
 * setCompEmoji() then simply skips setEmoji() — and `emoji: undefined` omits
 * the option key entirely (an empty string would serialise to `emoji: null`).
 *
 * NEVER returns undefined from setEmoji()'s point of view: the builder must not
 * be called with undefined/null (both throw a ValidationError — that was the
 * shop-browse crash), which is exactly what setCompEmoji() guarantees.
 */
function eComp(name, fallbackEmoji) {
  const key = String(name || '').toLowerCase();

  const resolved = e(name);
  if (resolved && resolved.startsWith('<')) {
    const id = tagId(resolved);
    if (id && componentUsable(id)) return resolved; // usable custom emoji
  }

  // The caller's own emoji (a category/product/admin-supplied one) goes first
  // so an explicit choice is never shadowed — but only when it is already a
  // custom tag: seeded unicode rows (🚀 ₿ ✦) fall through to the pack.
  const matched = keyForLabel(name);
  const candidates = [
    fallbackEmoji,
    UI_EMOJIS[key],
    EMOJI_FALLBACKS[key],
    matched ? UI_EMOJIS[matched] : null,
    matched ? EMOJI_FALLBACKS[matched] : null,
    matched && matched !== key ? customEmojiCache.get(matched) : null,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const s = String(candidate).trim();
    if (!s.startsWith('<')) continue; // unicode/text — never in a component
    const id = tagId(s);
    if (id && componentUsable(id)) return s; // usable custom emoji
    // stale custom emoji — never put it in a component
  }
  return undefined; // no usable custom emoji → component renders emoji-less
}

/**
 * Attach an emoji to a component builder without ever feeding setEmoji() a
 * value it rejects. Empirically, in this discord.js version BOTH
 * `setEmoji(undefined)` and `setEmoji(null)` throw — so "no emoji" is
 * achieved by NOT CALLING setEmoji at all.
 *
 *   setCompEmoji(new ButtonBuilder()…, eComp('shop'))
 */
function setCompEmoji(builder, value) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  if (!s) return builder; // leave the component emoji-less — never throws
  try {
    builder.setEmoji(s);
  } catch {
    /* value discord.js rejects — leave emoji-less rather than feed it a
       Discord-default emoji, which the UI no longer renders anywhere */
  }
  return builder;
}

/**
 * Scan every guild the client is in and map each custom emoji onto a UI key
 * (fuzzy name match). Re-runs on guild create/update so newly uploaded emojis
 * are picked up live. Returns the number of keys matched.
 */
function setEmojiClient(client) {
  customEmojiCache.clear();
  seedApplicationEmojis();
  guildEmojiIds = new Set(); // rebuilt every scan — only currently-shared guilds
  if (!client) return Object.keys(APPLICATION_EMOJIS).length;

  // Every custom emoji of every guild the bot is in is usable in components.
  const found = new Map(); // key -> { id, animated, name }
  for (const guild of client.guilds.cache.values()) {
    for (const emoji of guild.emojis.cache.values()) {
      guildEmojiIds.add(emoji.id);
      const key = keyForEmojiName(emoji.name);
      if (!key) continue;
      // Prefer a non-animated emoji and the shortest name (closest match).
      const prev = found.get(key);
      if (!prev || (prev.animated && !emoji.animated) || emoji.name.length < prev.name.length) {
        found.set(key, { id: emoji.id, animated: Boolean(emoji.animated), name: emoji.name });
      }
    }
  }

  // This application's own synced emojis become usable once fetched (async).
  loadAppEmojis(client);

  let matched = 0;
  for (const [key, info] of found) {
    customEmojiCache.set(key, `<${info.animated ? 'a' : ''}:${info.name}:${info.id}>`);
    matched++;
  }
  return matched;
}

/** Every custom emoji of every guild, tagged with the UI key it matches. */
function guildEmojiList(client) {
  const list = [];
  if (!client) return list;
  for (const guild of client.guilds.cache.values()) {
    for (const emoji of guild.emojis.cache.values()) {
      list.push({
        name: emoji.name,
        id: emoji.id,
        animated: Boolean(emoji.animated),
        guild: guild.name,
        key: keyForEmojiName(emoji.name),
        mention: `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`,
      });
    }
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

/** Re-scan guild emojis. */
function refreshEmojis(client) {
  return setEmojiClient(client);
}

/** Base branded embed with the X SHOP purple palette + footer. */
function brand(color = COLORS.primary) {
  return new EmbedBuilder().setColor(color).setFooter({ text: FOOTER });
}

/** ₹598 / ₹1,299.50 */
function fmtMoney(amount, currency = config.currency) {
  const n = Number(amount) || 0;
  const text = Number.isInteger(n)
    ? n.toLocaleString('en-IN')
    : n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${currency}${text}`;
}

function fmtStock(product) {
  if (product.stock === -1) return `${e('completed')} Available`;
  if (product.stock <= 0) return `${e('cancelled')} Out of stock`;
  return `${e('completed')} Available (${product.stock} left)`;
}

/**
 * Mockup-style stock badge: `🟢 In Stock` / `🟢 5 In Stock` / `🔴 Out of Stock`.
 */
function stockBadge(product) {
  if (!product || product.stock === 0) return `${e('cancelled')} Out of Stock`;
  if (product.stock === -1) return `${e('completed')} In Stock`;
  return `${e('completed')} ${product.stock} In Stock`;
}

/**
 * Customer-facing "Step N of 4" progress line. Stages: qty → details (only for
 * products with questions) → pay → verify. `stage` is the stage the customer
 * is currently on.
 */
function stepLine(product, stage) {
  const stages = ['qty', ...(product && productsHaveDetails(product) ? ['details'] : []), 'pay', 'verify'];
  const n = Math.max(1, stages.indexOf(stage) + 1 || 1);
  return `Step ${n} of ${stages.length}`;
}

/** Cheap check whether a product asks order questions (mirrors products.questionsOf). */
function productsHaveDetails(product) {
  if (!product) return false;
  try {
    const q = JSON.parse(product.questions || '[]');
    return Array.isArray(q) && q.length > 0;
  } catch {
    return false;
  }
}

/** Shop banner image URL (settings `shop_banner`, set with !setbanner). */
function bannerUrl() {
  try {
    return require('../database/db').getSetting('shop_banner') || null;
  } catch {
    return null;
  }
}

/** Shop logo image URL (settings `shop_logo`, set with !setlogo). */
function logoUrl() {
  try {
    return require('../database/db').getSetting('shop_logo') || null;
  } catch {
    return null;
  }
}

const ORDER_STATUS = {
  pending: { label: 'PENDING', emoji: e('pending'), color: COLORS.warning },
  awaiting_payment: { label: 'AWAITING PAYMENT', emoji: e('pending'), color: COLORS.warning },
  payment_review: { label: 'PAYMENT REVIEW', emoji: e('review'), color: COLORS.info },
  processing: { label: 'PROCESSING', emoji: e('processing'), color: COLORS.violet },
  completed: { label: 'COMPLETED', emoji: e('completed'), color: COLORS.success },
  cancelled: { label: 'CANCELLED', emoji: e('cancelled'), color: COLORS.danger },
  refunded: { label: 'REFUNDED', emoji: e('refunded'), color: COLORS.muted },
};

function statusLine(status) {
  const s = ORDER_STATUS[status] || ORDER_STATUS.pending;
  return `${s.emoji} ${s.label}`;
}

const ACTIVE_STATUSES = ['pending', 'awaiting_payment', 'payment_review', 'processing'];

/**
 * 5-step progress tracker, e.g.
 *   1️⃣ Product      ✅
 *   2️⃣ Quantity     ⏳
 */
function progressTracker(order) {
  let stage = {
    pending: 1,
    awaiting_payment: 2,
    payment_review: 3,
    processing: 4,
    completed: 5,
    cancelled: -1,
    refunded: -1,
  }[order.order_status];
  if (stage === undefined) stage = 1;
  // While still "pending", derive the stage from what the customer filled in.
  if (order.order_status === 'pending') {
    stage = (order.quantity || 0) > 0 ? 2 : 1;
  }

  const steps = [
    ['Product', 'shop'], ['Quantity', 'cart'], ['Payment', 'card'],
    ['Verification', 'review'], ['Delivery', 'delivery'],
  ];
  const head =
    stage === -1
      ? `${e('cancelled')} **Cancelled** — no further steps`
      : `${progressBar(stage, steps.length)}  ${statusLine(order.order_status)}`;
  return [
    head,
    '',
    ...steps.map(([label, icon], i) => {
      const mark = stage === -1 ? '◦' : i < stage ? e('completed') : i === stage ? e('pending') : '◦';
      return `\`${String(i + 1).padStart(2, '0')}\` ${e(icon)} ${mark} **${label}**`;
    }),
  ].join('\n');
}

module.exports = {
  COLORS,
  FOOTER,
  DIV,
  DIV_SOFT,
  BULLET,
  DOT,
  brand,
  fmtMoney,
  fmtStock,
  stockBadge,
  stepLine,
  bannerUrl,
  logoUrl,
  ORDER_STATUS,
  statusLine,
  progressTracker,
  progressBar,
  kv,
  section,
  heroLines,
  quote,
  lead,
  plain,
  ACTIVE_STATUSES,
  e,
  eMaybe,
  eComp,
  setCompEmoji,
  emojiUsable,
  loadAppEmojis,
  setEmojiClient,
  refreshEmojis,
  clearEmojiCache,
  EMOJI_KEYS,
  validEmojiValue,
  keyForEmojiName,
  keyForLabel,
  customTag,
  emojiReport,
  emojiSource,
  setEmojiValue,
  guildEmojiList,
};
