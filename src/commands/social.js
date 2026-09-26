'use strict';

/**
 * Social proof commands — `!vouch` and `!deal`.
 *
 *   !vouch @player <product>   → staff confirms "@player legit got <product>"
 *                                 in the vouch channel, with a running counter.
 *   !deal @customer <product>  → posts "DEAL COMPLETE!" with dealer, customer,
 *                                 product and acceptance time to the deal channel.
 *
 * Both channels resolve from the settings table first (`!vouchchannel`,
 * `!dealchannel`) and fall back to VOUCH_CHANNEL_ID / DEAL_CHANNEL_ID in .env.
 * Every successfully posted receipt is also stored (src/services/
 * socialProof.js) — that is what the shop panel's Vouches / Deals tabs render.
 *
 * The receipts are built like the rest of the storefront: everything stacks
 * line wise with `>` quote rows and the uploaded emoji pack only — no
 * Discord-default emoji anywhere.
 *
 * Slash mirrors live in slash-staff.js and route through the same handler, so
 * permissions, validation and error logging are identical.
 */

const config = require('../config/config');
const { getSetting, setSetting } = require('../database/db');
const { onCooldown } = require('../services/antiSpam');
const socialProof = require('../services/socialProof');
const { errorLog } = require('../services/logs');
const {
  brand,
  COLORS,
  DOT,
  e,
  heroLines,
  quote,
  lead,
  section,
  plain,
} = require('../utils/embeds');

/** `!vouch @player <product>` — mention first, product after (slash adds ` | `). */
const MENTION_RE = /^<@!?(\d+)>\s*\|?\s*([\s\S]+)$/;

/** `#channel` / `<#id>` / raw id — how the channel setters receive a target. */
const CHANNEL_RE = /<#(\d{17,20})>|^(\d{17,20})$/;

/** Settings key first, .env fallback — same pattern as the other channels. */
function channelFor(kind) {
  const stored = getSetting(`${kind}_channel`);
  if (stored) return stored;
  return kind === 'vouch' ? config.vouchChannelId : config.dealChannelId;
}

async function resolveChannel(message, kind) {
  const id = channelFor(kind);
  if (!id) {
    return { error: `No ${kind} channel set — run \`!${kind}channel #channel\` first.` };
  }
  try {
    const channel = await message.client.channels.fetch(id);
    if (!channel || !channel.isTextBased()) throw new Error('not a text channel');
    return { channel };
  } catch {
    return { error: `The configured ${kind} channel is unreadable — set it again with \`!${kind}channel #channel\`.` };
  }
}

/** Target's avatar for the receipt thumbnail (null when Discord can't tell us). */
async function targetAvatar(client, targetId) {
  try {
    const user = await client.users.fetch(targetId);
    return user?.displayAvatarURL?.({ size: 256 }) || null;
  } catch {
    return null;
  }
}

/** Shared `!vouch` / `!deal` body — only the embed differs. */
function socialCommand({ name, usage, kind, buildEmbed, titleKey, level = 'staff', cooldownMs = 5000 }) {
  return {
    name,
    level,
    usage,
    run: async (message, rest) => {
      const parsed = String(rest || '').trim().match(MENTION_RE);
      if (!parsed) {
        return message.reply(`${e('info')} Usage: \`${usage}\``);
      }
      const targetId = parsed[1];
      const product = plain(parsed[2]).trim().slice(0, 120);
      if (!product) {
        return message.reply(`${e('warning')} Give the product name — \`${usage}\``);
      }

      const wait = onCooldown(`${name}:${message.author.id}`, cooldownMs);
      if (wait) {
        return message.reply(
          `${e('warning')} Slow down — try again in ${Math.ceil(wait / 1000)}s.`
        );
      }

      const { channel, error } = await resolveChannel(message, kind);
      if (error) return message.reply(`${e('warning')} ${error}`);

      // Record BEFORE building so the receipt shows the new running totals,
      // and roll the row back when the channel post fails — a receipt must
      // never exist for a vouch/deal nobody can see.
      const thumb = await targetAvatar(message.client, targetId);
      let proof = null;
      try {
        proof = socialProof.recordProof(kind, targetId, message.author.id, product);
      } catch (err) {
        await errorLog(`command !${name} (receipt)`, err);
      }

      try {
        const embed = buildEmbed({ targetId, product, author: message.author, channel, proof, thumb });
        await channel.send({ embeds: [embed] });
      } catch (err) {
        if (proof) socialProof.removeProof(proof.id);
        await errorLog(`command !${name}`, err);
        return message.reply(`${e('warning')} Could not post to the ${kind} channel.`);
      }

      return message.reply(`${e('completed')} Posted to <#${channel.id}> ${titleKey}`);
    },
  };
}

/** `!vouch @player <product>` — "X legit got Y", with the member's vouch count. */
const vouch = socialCommand({
  name: 'vouch',
  usage: '!vouch @player <product name>',
  kind: 'vouch',
  level: 'public', // everyone may vouch — spam is capped by the cooldown
  cooldownMs: 15_000,
  titleKey: `${e('star')} vouched.`,
  buildEmbed: ({ targetId, product, author, proof, thumb }) =>
    brand(COLORS.black)
      .setTitle(lead(e('crown'), 'VERIFIED VOUCH'))
      .setDescription(
        [
          ...heroLines('Staff-confirmed purchase — 100% legit.'),
          '',
          section('Receipt'),
          quote(`${e('completed')} <@${targetId}> legit got **${product}**`),
          quote(`${e('staff')} Vouched by  ${DOT}  <@${author.id}>`),
          quote(`${e('diamond')} Vouch  ${DOT}  **#${proof?.totalForTarget ?? 1}** for this member`),
          quote(`${e('review')} Verified  ${DOT}  <t:${Math.floor(Date.now() / 1000)}:R>`),
          '',
          quote(`${e('heart')} Every vouch is posted by staff — X SHOP stays trusted.`),
        ].join('\n')
      )
      .setThumbnail(thumb),
});

/** `!deal @customer <product>` — deal completed: dealer, customer, product, date. */
const deal = socialCommand({
  name: 'deal',
  usage: '!deal @customer <product name>',
  kind: 'deal',
  titleKey: `${e('fire')} deal sealed.`,
  buildEmbed: ({ targetId, product, author, proof, thumb }) =>
    brand(COLORS.black)
      .setTitle(lead(e('fire'), 'DEAL COMPLETE'))
      .setDescription(
        [
          ...heroLines('A deal has successfully completed in **X SHOP**.'),
          '',
          section('Deal receipt'),
          quote(`${e('staff')} Dealer  ${DOT}  <@${author.id}>`),
          quote(`${e('star')} Customer  ${DOT}  <@${targetId}>`),
          quote(`${e('cart')} Product  ${DOT}  **${product}**`),
          quote(`${e('completed')} Status  ${DOT}  Accepted & completed`),
          quote(`${e('review')} Sealed  ${DOT}  <t:${Math.floor(Date.now() / 1000)}:R>`),
          quote(`${e('diamond')} Deal  ${DOT}  **#${proof?.totalAll ?? 1}** total`),
          '',
          quote(`${e('heart')} Thank you for trading with X SHOP.`),
        ].join('\n')
      )
      .setThumbnail(thumb),
});

/** Shared `!vouchchannel` / `!dealchannel` setter (settings-table storage). */
function channelCommand(kind, label) {
  const usage = `!${kind}channel #channel`;
  return {
    name: `${kind}channel`,
    level: 'admin',
    usage,
    run: async (message, rest) => {
      const arg = String(rest || '').trim();

      // No argument → report the current setup.
      if (!arg) {
        const current = channelFor(kind);
        return message.reply(
          current
            ? `${e('info')} The ${kind} channel is <#${current}>.`
            : `${e('warning')} No ${kind} channel set — run \`!${kind}channel #channel\`.`
        );
      }

      // `off` clears the stored override (the .env fallback still applies).
      if (/^(off|none|clear|disable)$/i.test(arg)) {
        setSetting(`${kind}_channel`, '');
        return message.reply(`${e('completed')} Stored ${kind} channel override cleared.`);
      }

      const match = arg.match(CHANNEL_RE);
      if (!match) {
        return message.reply(`${e('warning')} Mention a channel — \`${usage}\``);
      }
      const channelId = match[1] || match[2];
      setSetting(`${kind}_channel`, channelId);
      return message.reply(`${e('completed')} ${label} channel set to <#${channelId}>.`);
    },
  };
}

module.exports = [
  vouch,
  deal,
  channelCommand('vouch', 'Vouch'),
  channelCommand('deal', 'Deal'),
];
