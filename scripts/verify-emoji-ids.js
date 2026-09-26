'use strict';
/* One-off live check: every emoji id referenced by the UI (uiEmojis.json,
 * applicationEmojis.json) verified against this application's emoji list and
 * the CDN. Run: node scripts/verify-emoji-ids.js */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN_ENV || process.env.DISCORD_TOKEN;
const APP_ID = process.env.CLIENT_ID;

const files = {
  ui: path.join(__dirname, '..', 'src', 'utils', 'uiEmojis.json'),
  app: path.join(__dirname, '..', 'src', 'utils', 'applicationEmojis.json'),
};

const TAG = /<a?:(\w{2,32}):(\d{17,20})>/g;
const ids = new Map(); // id -> [where]
for (const [label, file] of Object.entries(files)) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, tag] of Object.entries(json)) {
    for (const m of String(tag).matchAll(TAG)) {
      if (!ids.has(m[2])) ids.set(m[2], []);
      ids.get(m[2]).push(`${label}:${key}(${m[1]})`);
    }
  }
}

(async () => {
  const headers = { Authorization: `Bot ${TOKEN}` };
  const appRes = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/emojis`, { headers });
  if (!appRes.ok) {
    console.error(`app emojis fetch failed: HTTP ${appRes.status}`);
    process.exit(1);
  }
  const appJson = await appRes.json();
  const appIds = new Set((appJson.items || []).map((it) => it.id));

  let stale = 0;
  for (const [id, where] of [...ids.entries()].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
    const cdn = await fetch(`https://cdn.discordapp.com/emojis/${id}.png`, { method: 'GET' });
    const inApp = appIds.has(id);
    const ok = cdn.ok && inApp;
    if (!ok) stale++;
    console.log(
      `${ok ? 'OK  ' : 'BAD '} ${id}  app=${inApp ? 'y' : 'n'} cdn=${cdn.status}  ${where.join(',')}`
    );
  }
  console.log(`\n${stale ? `${stale} STALE ID(S) FOUND` : 'all ids alive'}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
