'use strict';

require('dotenv').config();
const path = require('path');

const get = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    console.error(`[X SHOP] Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return v;
};

const int = (name, fallback) => parseInt(get(name, String(fallback)), 10);

/** "a, b c" → ['a', 'b', 'c'] — used by OWNER_IDS (any number of owners). */
const list = (name, fallback = '') =>
  get(name, fallback)
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** A Discord snowflake (17-20 digits). */
const isSnowflake = (id) => /^\d{17,20}$/.test(id);

// Owners get every order DM and full admin rights. OWNER_IDS accepts as many
// ids as you like (comma or space separated) and the singular OWNER_ID is
// still supported and merged in, so existing .env files keep working as-is.
const listedOwners = [...new Set([...list('OWNER_ID'), ...list('OWNER_IDS')])];
const ownerIds = listedOwners.filter(isSnowflake);
if (!ownerIds.length) {
  console.error(
    '[X SHOP] Missing required environment variable: OWNER_ID (or OWNER_IDS with at least one valid id)'
  );
  process.exit(1);
}
{
  const invalid = listedOwners.filter((id) => !isSnowflake(id));
  if (invalid.length) console.warn(`⚠️ Ignoring invalid owner id(s): ${invalid.join(', ')}`);
}

const ACTIVITY_TYPES = ['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING'];
const BOT_STATUSES = ['online', 'idle', 'dnd', 'invisible'];

/** Bot presence ("Listening to …") — every part is editable from .env. */
function presenceConfig() {
  let type = get('BOT_ACTIVITY_TYPE', 'WATCHING').trim().toUpperCase() || 'WATCHING';
  if (!ACTIVITY_TYPES.includes(type)) {
    console.warn(`⚠️ Unknown BOT_ACTIVITY_TYPE "${type}" — falling back to WATCHING.`);
    type = 'WATCHING';
  }

  let status = get('BOT_STATUS', 'online').trim().toLowerCase() || 'online';
  if (status === 'offline') status = 'invisible'; // Discord's "offline" = invisible
  if (!BOT_STATUSES.includes(status)) {
    console.warn(`⚠️ Unknown BOT_STATUS "${status}" — falling back to online.`);
    status = 'online';
  }

  const url = get('BOT_ACTIVITY_URL', '').trim();
  if (type === 'STREAMING' && !/^https?:\/\//i.test(url)) {
    console.warn(
      '⚠️ BOT_ACTIVITY_TYPE=STREAMING needs BOT_ACTIVITY_URL (twitch/youtube) — using WATCHING instead.'
    );
    type = 'WATCHING';
  }

  return {
    type,
    status,
    url,
    // Present-but-empty ⇒ no activity at all (status only); absent ⇒ default.
    text:
      process.env.BOT_ACTIVITY_TEXT === undefined
        ? 'X SHOP • type "buy"'
        : String(process.env.BOT_ACTIVITY_TEXT).trim(),
    emoji: !/^(off|false|0|no|none)$/i.test(get('BOT_ACTIVITY_EMOJI', 'on').trim()),
  };
}

const REVIEW_TARGETS = ['dm', 'channel', 'both'];

/**
 * Where the staff payment-review panel is delivered. It is staff-only, so it
 * is never posted inside the customer's ticket:
 *   dm      → DM every owner (default)
 *   channel → a dedicated review channel
 *   both    → the review channel + every owner DM
 */
function reviewConfig() {
  let target = get('ORDER_REVIEW_TARGET', 'dm').trim().toLowerCase() || 'dm';
  if (!REVIEW_TARGETS.includes(target)) {
    console.warn(`⚠️ Unknown ORDER_REVIEW_TARGET "${target}" — falling back to dm.`);
    target = 'dm';
  }
  const channelId = get('ORDER_REVIEW_CHANNEL_ID', '').trim();
  if ((target === 'channel' || target === 'both') && !channelId) {
    console.warn('⚠️ ORDER_REVIEW_CHANNEL_ID is empty — review panels go to owner DMs only.');
    target = 'dm';
  }
  return { target, channelId };
}

const config = {
  token: get('DISCORD_TOKEN'),
  clientId: get('CLIENT_ID'),
  guildId: get('GUILD_ID', ''),
  ownerId: ownerIds[0], // first owner — kept for backwards compatibility
  ownerIds, // every owner: order DMs + full admin rights

  shopChannelId: get('SHOP_CHANNEL_ID'),
  staffRoleId: get('STAFF_ROLE_ID'),
  adminRoleId: get('ADMIN_ROLE_ID', ''),
  orderCategoryId: get('ORDER_CATEGORY_ID', ''),

  logs: {
    orders: get('ORDER_LOG_CHANNEL_ID', ''),
    payments: get('PAYMENT_LOG_CHANNEL_ID', ''),
    staff: get('STAFF_LOG_CHANNEL_ID', ''),
    errors: get('ERROR_LOG_CHANNEL_ID', ''),
  },

  // Social proof channels — `!vouchchannel` / `!dealchannel` override these.
  vouchChannelId: get('VOUCH_CHANNEL_ID', ''),
  dealChannelId: get('DEAL_CHANNEL_ID', ''),

  prefix: get('PREFIX', '!'),
  triggers: get('BUY_TRIGGERS', 'buy,shop,purchase')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),

  currency: get('CURRENCY', '₹'),

  // Anti-spam tuning
  buyCooldownMs: int('BUY_COOLDOWN_MS', 10_000),
  ticketCooldownMs: int('TICKET_COOLDOWN_MS', 60_000),
  proofCooldownMs: int('PROOF_COOLDOWN_MS', 15_000),
  maxActiveOrders: int('MAX_ACTIVE_ORDERS', 3),

  // DATA_DIR override keeps tests away from the live database.
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'),
  assetsDir: path.join(__dirname, '..', '..', 'assets'),
  qrDir: path.join(__dirname, '..', '..', 'assets', 'qr'),

  // Bot presence — change what the bot shows ("Listening to …") from .env.
  presence: presenceConfig(),

  // Where staff verify payments (never inside the customer ticket).
  review: reviewConfig(),

  // Web dashboard (disabled until WEB_DASHBOARD_PASSWORD is set)
  web: {
    password: get('WEB_DASHBOARD_PASSWORD', ''),
    port: int('WEB_PORT', 3000),
    host: get('WEB_HOST', '0.0.0.0'),
  },
};

module.exports = config;
