'use strict';

const { MessageFlags } = require('discord.js');
const config = require('../config/config');
const products = require('../products/products');
const orders = require('../orders/orders');
const { getSetting } = require('../database/db');
const { replyEphemeral, WRONG_USER } = require('../utils/interactions');
const { onCooldown } = require('../services/antiSpam');
const { notifyOwner } = require('../services/notify');
const { orderLog } = require('../services/logs');
const { brand, COLORS, e } = require('../utils/embeds');
const socialProof = require('../services/socialProof');
const orderViews = require('../services/orderViews');
const views = require('./views');
const { isBlacklisted } = require('../web/queries');
const flow = require('../tickets/flow');
const { createTicketChannel, permissionHint } = require('../tickets/create');
const { errorLog } = require('../services/logs');

/**
 * Public shop interactions. Category/product browsing is shared — every user
 * may use the select menus. Only the Buy Now action is bound to the user who
 * selected the product.
 */
async function handleComponent(interaction) {
  const [, action, a, b] = interaction.customId.split(':');
  // `bst:` panels (posted by !buysetup) open a ticket on category select;
  // `shop:` panels (the buy trigger / !panel) keep the classic browse flow.
  const ticketMode = interaction.customId.startsWith('bst:');

  if (action === 'buynow') {
    // Buy Now button on the !buysetup panel — ticket opens with the buy menu.
    return startBuyNowTicket(interaction);
  }

  if (action === 'tab') {
    // Panel tabs — Shop / Vouches / Deals. The tab screens edit the panel
    // message in place, so the stored `panel:<channelId>` id stays valid.
    if (a === 'vouch') {
      return interaction.update(
        views.vouchesTab(socialProof.stats('vouch'), socialProof.listProofs('vouch', 8), ticketMode)
      );
    }
    if (a === 'deals') {
      return interaction.update(
        views.dealsTab(socialProof.stats('deal'), socialProof.listProofs('deal', 8), ticketMode)
      );
    }
    return interaction.update(views.shopPanel(products.listCategories(), ticketMode));
  }

  if (action === 'catbtn') {
    // Quick-open category button on the main panel.
    const category = products.getCategory(Number(a));
    if (!category || category.status !== 'active') {
      return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
    }
    if (ticketMode) return startCategoryTicket(interaction, category);
    const list = products.listProducts(category.id);
    if (!list.length) return replyEphemeral(interaction, `${e('warning')} No products in this category yet.`);
    return interaction.update(views.categoryMenu(category, list));
  }

  if (action === 'cat') {
    // The selected category id arrives in interaction.values[0], not the customId.
    const category = products.getCategory(Number(interaction.values[0]));
    if (!category || category.status !== 'active') {
      return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
    }
    if (ticketMode) return startCategoryTicket(interaction, category);
    const list = products.listProducts(category.id);
    if (!list.length) return replyEphemeral(interaction, `${e('warning')} No products in this category yet.`);
    return interaction.update(views.categoryMenu(category, list));
  }

  if (action === 'prod') {
    // The selected product id arrives in interaction.values[0], not the customId.
    const product = products.getProduct(Number(interaction.values[0]));
    if (!product || product.status !== 'active' || product.stock === 0) {
      return replyEphemeral(interaction, `${e('warning')} This product is no longer available.`);
    }
    const category = products.getCategory(product.category_id);
    if (!category || category.status !== 'active') {
      return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
    }
    return interaction.update(views.productDetails(category, product, interaction.user.id));
  }

  if (action === 'buy') {
    if (interaction.user.id !== b) return replyEphemeral(interaction, WRONG_USER);
    return startPurchase(interaction, products.getProduct(Number(a)));
  }

  if (action === 'back') {
    if (a === 'cats') {
      const categories = products.listCategories();
      return interaction.update(views.shopPanel(categories));
    }
    if (a === 'cat') {
      const category = products.getCategory(Number(b));
      const list = category ? products.listProducts(category.id) : [];
      if (!category || category.status !== 'active' || !list.length) {
        return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
      }
      return interaction.update(views.categoryMenu(category, list));
    }
  }
}


// ── Category select / Buy Now → private ticket ─────────────────────────────

/**
 * Shared pre-ticket guards for both ticket openers. Returns the ephemeral
 * error message to send, or null when the customer may proceed.
 */
async function ticketStartBlock(interaction) {
  if (getSetting('maintenance') === '1') {
    return `${e('staff')} The shop is under maintenance right now. Please try again later.`;
  }
  if (isBlacklisted(interaction.user.id)) {
    return `${e('cancelled')} You are blocked from purchasing. Contact staff if you think this is a mistake.`;
  }
  const wait = onCooldown(`ticket:${interaction.user.id}`, config.ticketCooldownMs);
  if (wait) {
    return `${e('pending')} Please wait **${Math.ceil(wait / 1000)}s** before creating another order.`;
  }
  // One open pick-ticket per customer; self-heals when the old channel is gone.
  const pendingId = flow.getPendingPickChannel(interaction.user.id);
  if (pendingId) {
    const existing = await interaction.guild.channels.fetch(pendingId).catch(() => null);
    if (existing) {
      return `${e('pending')} You already have an open ticket: <#${pendingId}> — choose your product there.`;
    }
    flow.clearPendingPick(interaction.user.id);
  }
  return null;
}

/** Create the ticket, post the first pick screen and confirm ephemerally. */
async function openPickTicket(interaction, label, readyHint, view) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let channel = null;
  try {
    channel = await createTicketChannel(interaction.client, interaction.guild, interaction.user, label);
    flow.setPendingPick(interaction.user.id, channel.id);
    await channel.send(view);
    await interaction.editReply(`${e('ticket')} Your ticket is ready: ${channel} — ${readyHint}`);
  } catch (err) {
    await errorLog(`category ticket (${label})`, err);
    if (channel) await channel.delete('X SHOP — ticket setup failed').catch(() => {});
    flow.clearPendingPick(interaction.user.id);
    const text = `${e('warning')} Could not open your ticket — please try again in a moment.`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(text).catch(() => {});
    else await replyEphemeral(interaction, text);
  }
}

/**
 * Category chosen on a !buysetup panel — open the customer's ticket right away.
 * The panel itself is never edited; the product is picked inside the ticket
 * (ord:pick), and from the quantity stepper onward the flow is unchanged.
 */
async function startCategoryTicket(interaction, category) {
  const list = products.listProducts(category.id);
  if (!list.length) return replyEphemeral(interaction, `${e('warning')} No products in this category yet.`);

  const blocked = await ticketStartBlock(interaction);
  if (blocked) return replyEphemeral(interaction, blocked);

  await openPickTicket(interaction, category.name, 'choose your product there.', views.pickProductView(
    category,
    list,
    interaction.user.id
  ));
}

/** Buy Now button on a !buysetup panel — ticket opens with the full buy menu. */
async function startBuyNowTicket(interaction) {
  const categories = products.listCategories();
  if (!categories.length) return replyEphemeral(interaction, `${e('warning')} No categories available yet.`);

  const blocked = await ticketStartBlock(interaction);
  if (blocked) return replyEphemeral(interaction, blocked);

  await openPickTicket(interaction, 'menu', 'pick a category, then a product there.', views.buyNowMenuView(
    categories,
    interaction.user.id
  ));
}

// ── Buy Now → private ticket ────────────────────────────────────────────────

async function startPurchase(interaction, product) {
  if (!product || product.status !== 'active') {
    return replyEphemeral(interaction, `${e('warning')} This product is no longer available.`);
  }
  if (product.stock === 0) return replyEphemeral(interaction, `${e('cancelled')} This product is out of stock.`);
  if (getSetting('maintenance') === '1') {
    return replyEphemeral(interaction, `${e('staff')} The shop is under maintenance right now. Please try again later.`);
  }
  if (isBlacklisted(interaction.user.id)) {
    return replyEphemeral(
      interaction,
      `${e('cancelled')} You are blocked from purchasing. Contact staff if you think this is a mistake.`
    );
  }

  const wait = onCooldown(`ticket:${interaction.user.id}`, config.ticketCooldownMs);
  if (wait) {
    return replyEphemeral(
      interaction,
      `${e('pending')} Please wait **${Math.ceil(wait / 1000)}s** before creating another order.`
    );
  }

  if (orders.activeCount(interaction.user.id) >= config.maxActiveOrders) {
    return replyEphemeral(
      interaction,
      `${e('cancelled')} You already have **${config.maxActiveOrders}** active orders. Please complete them first.`
    );
  }

  const duplicate = orders.activeForProduct(interaction.user.id, product.id);
  if (duplicate) {
    return replyEphemeral(
      interaction,
      `${e('cancelled')} You already have an active order for this product: \`${duplicate.order_id}\``
    );
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let order = null;
  let channel = null;
  try {
    order = orders.createOrder(interaction.user, product);
    channel = await createTicketChannel(interaction.client, interaction.guild, interaction.user, product);
    orders.update(order.order_id, { ticket_channel_id: channel.id });
    orders.addEvent(order.order_id, 'order_created', interaction.user.id, channel.name);

    // postWelcome verifies/repairs the bot's own access and retries a
    // permission-denied send; it returns null when the channel itself is gone
    // (a moderation/cleanup bot removing tickets is the usual cause).
    const welcome = await flow.postWelcome(channel, orders.getByOrderId(order.order_id), product);
    if (!welcome) {
      throw new Error(
        'the order ticket was deleted or became unreachable right after creation — ' +
          'if a moderation/auto-cleanup bot removes new channels, whitelist the ' +
          '"order-" prefix or the tickets category'
      );
    }

    await interaction.editReply({ content: `${e('ticket')} Your private order ticket: ${channel}` });

    const notifyEmbed = orderViews.newOrderEmbed(orders.getByOrderId(order.order_id), channel);
    await notifyOwner(notifyEmbed);
    await orderLog(notifyEmbed);
  } catch (err) {
    // Never leave the customer with a dead order: roll back, clean up the
    // unusable channel, explain exactly what is wrong and log it for staff.
    if (order) orders.setStatus(order.order_id, 'cancelled', interaction.user.id, 'Ticket could not be opened');
    if (channel) await channel.delete('X SHOP order setup failed').catch(() => {});
    await errorLog('ticket-create', err);
    await interaction
      .editReply({
        content:
          `${e('warning')} Your ticket could not be opened — please contact staff.\n` +
          `${e('staff')} Admin fix: ${permissionHint(err)}`,
      })
      .catch(() => {});
    return;
  }
}

module.exports = { handleComponent, startPurchase };
