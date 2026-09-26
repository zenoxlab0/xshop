'use strict';

const config = require('../config/config');
const { getSetting, setSetting } = require('../database/db');
const { listCategories } = require('../products/products');
const { onCooldown } = require('../services/antiSpam');
const views = require('./views');
const { e, lead } = require('../utils/embeds');

/**
 * Public shop panel. When a customer types a buy trigger in the shop channel,
 * the previous panel is replaced so the channel stays clean.
 */
/**
 * Public shop panel. `ticketMode` posts the !buysetup flavour (`bst:` ids —
 * category select opens the ticket); the default is the classic buy panel
 * (category → product page → Buy button).
 */
async function postPanel(channel, ticketMode = false) {
  const categories = listCategories();
  if (!categories.length) {
    await channel.send(
      lead(e('warning'), '**X SHOP** is being set up — no categories available yet. Admins: use `!addcategory`.')
    );
    return null;
  }
  return replacePanel(channel, categories, ticketMode);
}

async function replacePanel(channel, categories, ticketMode = false) {
  const oldId = getSetting(`panel:${channel.id}`);
  if (oldId) {
    try {
      const old = await channel.messages.fetch(oldId);
      await old.delete();
    } catch {
      /* panel already gone */
    }
  }
  const msg = await channel.send(views.shopPanel(categories, ticketMode));
  setSetting(`panel:${channel.id}`, msg.id);
  return msg;
}

async function handleBuyTrigger(message) {
  if (getSetting('maintenance') === '1') {
    const m = await message.reply(
      `${e('staff')} **X SHOP** is currently under maintenance. Please try again later.`
    );
    setTimeout(() => m.delete().catch(() => {}), 8000);
    return;
  }

  const wait = onCooldown(`buy:${message.author.id}`, config.buyCooldownMs);
  if (wait) {
    const m = await message.reply(`${e('pending')} Please wait **${Math.ceil(wait / 1000)}s** before using this again.`);
    setTimeout(() => m.delete().catch(() => {}), 5000);
    return;
  }

  // Global panel cooldown — prevents two users racing to replace the panel.
  if (onCooldown(`panel:${message.channel.id}`, 5000)) return;

  await postPanel(message.channel);
}

module.exports = { postPanel, replacePanel, handleBuyTrigger };
