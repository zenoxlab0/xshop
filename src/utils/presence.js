'use strict';

/**
 * Configurable bot presence — what the bot shows as its activity and status.
 * Everything comes from .env, so it can be changed without touching code:
 *
 *   BOT_ACTIVITY_TYPE   PLAYING | STREAMING | LISTENING | WATCHING | COMPETING
 *   BOT_ACTIVITY_TEXT   the text shown after the verb (max 128 chars)
 *   BOT_ACTIVITY_EMOJI  on | off — prefix the shop emoji of the UI emoji set
 *   BOT_ACTIVITY_URL    only for STREAMING (twitch / youtube link)
 *   BOT_STATUS          online | idle | dnd | invisible
 *
 * `WATCHING` + `X SHOP • type "buy"` is the built-in default, so a .env file
 * without these keys behaves exactly like before.
 */

const { ActivityType } = require('discord.js');
const config = require('../config/config');

const ACTIVITY_TYPES = {
  PLAYING: ActivityType.Playing,
  STREAMING: ActivityType.Streaming,
  LISTENING: ActivityType.Listening,
  WATCHING: ActivityType.Watching,
  COMPETING: ActivityType.Competing,
};

/** Verb used in the startup log line, e.g. "Listening to". */
const VERBS = {
  PLAYING: 'Playing',
  STREAMING: 'Streaming',
  LISTENING: 'Listening to',
  WATCHING: 'Watching',
  COMPETING: 'Competing in',
};

/** The activity text, emoji-prefixed when BOT_ACTIVITY_EMOJI is on. */
function activityName(emojiResolver) {
  const text = String(config.presence.text || '').trim().slice(0, 128);
  if (!text) return ''; // BOT_ACTIVITY_TEXT empty → status only, no activity
  if (!config.presence.emoji || typeof emojiResolver !== 'function') return text;
  try {
    const icon = String(emojiResolver('shop') || '').trim();
    return (icon ? `${icon} ${text}` : text).slice(0, 128);
  } catch {
    return text;
  }
}

/** discord.js presence payload: `{ activities, status }`. */
function presenceFor(emojiResolver) {
  const { type, status, url } = config.presence;
  const name = activityName(emojiResolver);
  const activities = [];
  if (name) {
    const activity = { name, type: ACTIVITY_TYPES[type] ?? ActivityType.Watching };
    // Discord rejects STREAMING without a URL (config.js already falls back).
    if (activity.type === ActivityType.Streaming) activity.url = url;
    activities.push(activity);
  }
  return { activities, status };
}

/** One-line summary for the startup log: what the bot is showing right now. */
function describePresence(emojiResolver) {
  const { type, status } = config.presence;
  const name = activityName(emojiResolver);
  const verb = VERBS[type] || VERBS.WATCHING;
  return `${verb} ${name ? `"${name}"` : '(no activity)'} • ${status}`;
}

module.exports = { presenceFor, describePresence, activityName, ACTIVITY_TYPES, VERBS };
