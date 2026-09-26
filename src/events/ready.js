'use strict';

const { Events } = require('discord.js');
const { setClient: logsSetClient } = require('../services/logs');
const { setClient: notifySetClient } = require('../services/notify');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logsSetClient(client);
    notifySetClient(client);
    const { setEmojiClient, e } = require('../utils/embeds');
    const matched = setEmojiClient(client);

    // Register /help, /orders, /support (guild-scoped when GUILD_ID is set).
    const slash = require('../slash');
    await slash.registerSlashCommands(client);

    // Web dashboard — starts only when a password is configured.
    if (require('../config/config').web.password) {
      const { startDashboard } = require('../web/server');
      startDashboard(client);
    } else {
      console.warn('⚠️ WEB_DASHBOARD_PASSWORD is not set — the web dashboard stays OFF.');
    }

    // Presence ("Listening to …") is fully configurable from .env — see
    // src/utils/presence.js and the BOT_ACTIVITY_* / BOT_STATUS keys.
    const presence = require('../utils/presence');
    client.user.setPresence(presence.presenceFor(e));
    console.log(
      `✦ X SHOP online as ${client.user.tag} — serving ${client.guilds.cache.size} guild(s)` +
        (matched ? ` • ${matched} UI emoji key(s) matched to server emojis` : '')
    );
    console.log(`✦ Presence: ${presence.describePresence(e)}`);
    // ── Preflight: surface permission/config problems at startup instead of at
    //    a customer's buy click (e.g. DiscordAPIError 50001 Missing Access).
    try {
      const cfg = require('../config/config');
      const { PermissionFlagsBits } = require('discord.js');
      const problems = [];

      // Server membership first — every other check depends on it.
      if (client.guilds.cache.size === 0) {
        problems.push(
          'The bot is not in any server yet — invite it (README → Setup; the invite scope must ' +
            'include **bot** and **applications.commands**).'
        );
      } else if (cfg.guildId && !client.guilds.cache.has(cfg.guildId)) {
        problems.push(
          `GUILD_ID ${cfg.guildId} is not a server this bot is in (it is in: ` +
            `${client.guilds.cache.map((g) => `${g.name} (${g.id})`).join(', ')}) — fix GUILD_ID in .env.`
        );
      }

      for (const guild of client.guilds.cache.values()) {
        const me = guild.members.me;
        const where = (id) => `<#${id}>`;
        const can = (channelId, ...perms) => {
          const ch = guild.channels.cache.get(channelId);
          if (!ch) return { ok: false, why: 'channel not found in this guild' };
          const missing = perms.filter((p) => !ch.permissionsFor(me)?.has(p));
          return missing.length ? { ok: false, why: `missing ${missing.join(', ')}` } : { ok: true };
        };

        if (!cfg.shopChannelId) {
          problems.push(`[${guild.name}] SHOP_CHANNEL_ID is empty — the buy trigger cannot work.`);
        } else {
          const res = can(cfg.shopChannelId, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages);
          if (!res.ok) problems.push(`[${guild.name}] Shop channel ${where(cfg.shopChannelId)}: ${res.why}`);
        }

        if (cfg.orderCategoryId) {
          const res = can(
            cfg.orderCategoryId,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ManageChannels
          );
          if (!res.ok) problems.push(`[${guild.name}] Ticket category ${where(cfg.orderCategoryId)}: ${res.why}`);
        }

        if (cfg.staffRoleId && !guild.roles.cache.has(cfg.staffRoleId)) {
          problems.push(`[${guild.name}] STAFF_ROLE_ID ${cfg.staffRoleId} is not a role in this guild.`);
        }

        if (me && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
          problems.push(`[${guild.name}] The bot is missing **Manage Channels** — it cannot create tickets.`);
        }
      }

      if (problems.length) {
        console.warn('⚠️ Setup check found issues (run !doctor in the server):');
        for (const p of problems) console.warn(`   • ${p}`);
      } else {
        console.log('✦ Setup check: shop channel, ticket category and staff role all OK');
      }
    } catch {
      /* the preflight must never block startup */
    }

    // Pick up newly uploaded emojis live (no restart needed).
    const rescan = () => setEmojiClient(client);
    client.on(Events.GuildAvailable, rescan);
    client.on(Events.GuildCreate, rescan);
    client.on(Events.GuildEmojiCreate, rescan);
    client.on(Events.GuildEmojiDelete, rescan);
    client.on(Events.GuildEmojiUpdate, rescan);
  },
};
