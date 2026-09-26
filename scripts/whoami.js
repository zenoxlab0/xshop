'use strict';
/*
 * Read-only identity check: which bot does DISCORD_TOKEN belong to, and which
 * servers is it actually in? Nothing is changed.
 *
 *   npm run whoami
 *
 * Use this when the bot logs in but reports 0 guild(s) or "Unknown Guild":
 * it tells you whether the token's bot is really the one in your server.
 */
require('dotenv').config({ quiet: true });

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN) {
  console.error('[X SHOP] No DISCORD_TOKEN in .env');
  process.exit(1);
}

const api = async (path) => {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) return { error: `${res.status} ${body?.message || text}` };
  return body;
};

(async () => {
  const me = await api('/users/@me');
  if (me.error) {
    console.log(`❌ The DISCORD_TOKEN in .env is not valid: ${me.error}`);
    console.log('   → Developer Portal → Bot → Reset Token, put the new token in .env.');
    return;
  }

  const invite =
    `https://discord.com/api/oauth2/authorize?client_id=${me.id}` +
    '&permissions=125968&scope=bot%20applications.commands';

  console.log('✦ X SHOP — who am I? (read-only)\n');
  console.log(`  the token belongs to bot : ${me.username}  (id ${me.id})`);
  const sameApp = String(me.id) === String(CLIENT_ID);
  console.log(
    `  CLIENT_ID in .env        : ${CLIENT_ID}  ${sameApp ? '✅ matches the token' : '❌ MISMATCH — different application!'}`
  );

  const guilds = await api('/users/@me/guilds');
  if (guilds.error) {
    console.log(`  could not list servers   : ${guilds.error}`);
  } else if (!guilds.length) {
    console.log('  servers this bot is in   : ❌ NONE — the invite has not been completed.');
    console.log(`\n  Invite this bot now, then restart it:\n    ${invite}`);
  } else {
    console.log('  servers this bot is in   :');
    for (const g of guilds) console.log(`     • ${g.name}  (id ${g.id})`);
  }

  if (GUILD_ID) {
    const inGuild = Array.isArray(guilds) && guilds.some((g) => String(g.id) === String(GUILD_ID));
    console.log(
      `  GUILD_ID in .env         : ${GUILD_ID}  ${
        inGuild ? '✅ the bot is in that server' : '❌ the bot is NOT in that server'
      }`
    );
    if (!inGuild && Array.isArray(guilds) && guilds.length) {
      console.log('   → update GUILD_ID in .env to one of the ids above.');
    }
  }

  if (!sameApp) {
    console.log('\n  Fix: token and CLIENT_ID must belong to the SAME application —');
    console.log('  copy the matching token from the Developer Portal, or invite the application above.');
  }
})();