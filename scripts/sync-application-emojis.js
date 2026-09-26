#!/usr/bin/env node
'use strict';

/**
 * Sync source Discord custom emojis into this bot's Application Emojis.
 *
 * Usage:
 *   node scripts/sync-application-emojis.js
 *   node scripts/sync-application-emojis.js --write-source
 *
 * Requires DISCORD_TOKEN and CLIENT_ID in .env.
 * The source IDs are stored in src/utils/sourceEmojis.json.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN;
const APPLICATION_ID = process.env.CLIENT_ID;

if (!TOKEN || !APPLICATION_ID) {
  console.error('[X SHOP] Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const sourcePath = path.join(__dirname, '..', 'src', 'utils', 'sourceEmojis.json');
const outputPath = path.join(__dirname, '..', 'src', 'utils', 'applicationEmojis.json');

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

async function api(pathname, options = {}) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = body?.message || text || `HTTP ${res.status}`;
    throw new Error(`${res.status}: ${detail}`);
  }
  return body;
}

function mention(e) {
  return `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
}

async function downloadEmoji(id, animated) {
  const ext = animated ? 'gif' : 'png';
  const res = await fetch(`https://cdn.discordapp.com/emojis/${id}.${ext}?quality=lossless`);
  if (!res.ok) throw new Error(`CDN returned HTTP ${res.status} for .${ext}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error(`CDN returned an empty .${ext} asset`);
  if (buf.length > 256 * 1024) {
    throw new Error(`asset is ${Math.round(buf.length / 1024)} KiB (> 256 KiB)`);
  }
  const mime = animated ? 'image/gif' : 'image/png';
  return { image: `data:${mime};base64,${buf.toString('base64')}`, animated, bytes: buf.length };
}

async function downloadEmojiAuto(id) {
  // Discord's CDN returns the correct asset type for the matching extension.
  // Trying GIF first lets animated source emojis work; static emojis normally
  // return 404 for GIF and then succeed as PNG.
  const attempts = [true, false];
  const errors = [];

  for (const animated of attempts) {
    try {
      return await downloadEmoji(id, animated);
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error(`could not download emoji ${id}: ${errors.join(' | ')}`);
}

(async () => {
  console.log('[X SHOP] Reading application emojis...');
  const existing = await api(`/applications/${APPLICATION_ID}/emojis`);
  const byName = new Map((existing.items || []).map((e) => [e.name, e]));
  const output = {};

  for (const [key, src] of Object.entries(source)) {
    try {
      const old = byName.get(src.name);
      let emoji = old;

      if (!emoji) {
        const asset = await downloadEmojiAuto(src.id);
        emoji = await api(`/applications/${APPLICATION_ID}/emojis`, {
          method: 'POST',
          body: JSON.stringify({ name: src.name, image: asset.image }),
        });
        console.log(`  + ${key}: ${mention(emoji)} (${asset.animated ? 'animated/GIF' : 'static/PNG'}, ${Math.round(asset.bytes / 1024)} KiB)`);
      } else {
        console.log(`  = ${key}: ${mention(emoji)} (${emoji.animated ? 'animated' : 'static'}, already exists)`);
      }

      output[key] = mention(emoji);
    } catch (err) {
      console.error(`  ! ${key} (${src.name}:${src.id}) — ${err.message}`);
    }
  }

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + '\n');
  console.log(`\n[X SHOP] Wrote ${Object.keys(output).length} application emoji mappings to: ${outputPath}`);
  console.log('[X SHOP] Restart the bot after syncing.');
})().catch((err) => {
  console.error('[X SHOP] Emoji sync failed:', err.message);
  process.exit(1);
});
