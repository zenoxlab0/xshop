'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../config/config');
const orders = require('../orders/orders');
const products = require('../products/products');
const methods = require('../payments/methods');
const { getSetting } = require('../database/db');
const {
  brand,
  COLORS,
  fmtMoney,
  progressTracker,
  stepLine,
  statusLine,
  DOT,
  section,
  heroLines,
  plain,
  quote,
  lead,
  e,
  eMaybe,
  eComp,
} = require('../utils/embeds');
const { replyEphemeral, WRONG_USER } = require('../utils/interactions');
const { onCooldown } = require('../services/antiSpam');
const { notifyOwner } = require('../services/notify');
const { errorLog, orderLog, paymentLog, getClient } = require('../services/logs');
const orderViews = require('../services/orderViews');
const reviewPanel = require('../services/reviewPanel');
const { ensureBotAccess } = require('./create');

// ── Views ───────────────────────────────────────────────────────────────────

/**
 * Category tickets opened from the buy panel hold no order yet — the customer
 * picks the product inside the ticket. This in-memory registry keeps one open
 * pick-ticket per customer; it self-heals after restarts (the opener re-checks
 * the channel) and clears when an order is created or the ticket is left.
 */
const pendingPicks = new Map(); // userId -> channelId

const setPendingPick = (userId, channelId) => pendingPicks.set(String(userId), String(channelId));
const clearPendingPick = (userId) => pendingPicks.delete(String(userId));
const getPendingPickChannel = (userId) => pendingPicks.get(String(userId)) || null;

/** Panel 5 — private ticket welcome with the quantity stepper. */
function ticketEmbed(order, product) {
  const qty = order.quantity > 0 ? order.quantity : Math.max(1, product?.minimum_quantity || 1);
  const available =
    !product ? '—' : product.stock === -1 ? 'Unlimited' : `${Math.max(0, product.stock)} left`;

  const embed = brand(COLORS.primary)
    .setTitle(`${e('ticket')} Private Order — ${product ? product.name : order.product_name}`)
    .setDescription(
      [
        ...heroLines(`Welcome <@${order.discord_user_id}>, your private order is open.`),
        '',
        quote(
          lead(eMaybe(product?.name), `**${product ? product.name : order.product_name}**`)
        ),
        quote(`${e('money')} ${fmtMoney(order.unit_price)} ${DOT} ${e('stock')} Available: **${available}**`),
        quote(`${e('order')} Order ID ${DOT} \`${order.order_id}\``),
        quote(`${e('star')} Status ${DOT} ${statusLine(order.order_status)}`),
        '',
        section(stepLine(product, 'qty')),
        quote(`How many units would you like?`),
        quote(`Use **− / +** or **Custom Quantity**, then press **Next**.`,
        ),
        '',
        section(`${e('more')} Order Progress`),
        ...progressTracker(order).split('\n'),
      ].join('\n')
    );
  if (product?.image_url) embed.setThumbnail(product.image_url);
  return embed;
}

/** Stepper buttons: [−] [qty] [+] / [Next →] [🔢 Custom] [❌ Cancel]. */
function quantityRow(order, product) {
  const min = Math.max(1, product?.minimum_quantity || 1);
  const stockMax = !product || product.stock === -1 ? Infinity : product.stock;
  const hardMax = Math.min(product?.maximum_quantity || 10, stockMax);
  const out = !product || hardMax < min;
  const qty = Math.min(Math.max(order.quantity > 0 ? order.quantity : min, min), out ? min : hardMax);

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ord:qm:${order.order_id}`)
        .setLabel('−')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(out || qty <= min),
      new ButtonBuilder()
        .setCustomId(`ord:qshow:${order.order_id}`)
        .setLabel(String(qty))
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`ord:qp:${order.order_id}`)
        .setLabel('+')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(out || qty >= hardMax)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ord:next:${order.order_id}`)
        .setLabel('Next')
        .setEmoji(e('arrow'))
        .setStyle(ButtonStyle.Success)
        .setDisabled(out),
      new ButtonBuilder()
        .setCustomId(`ord:qtyc:${order.order_id}`)
        .setLabel('Custom Quantity')
        .setEmoji(e('order'))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(out),
      new ButtonBuilder()
        .setCustomId(`ord:cx:${order.order_id}`)
        .setLabel('Cancel Order')
        .setEmoji(e('cancelled'))
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function quantityView(order, product) {
  return { embeds: [ticketEmbed(order, product)], components: quantityRow(order, product) };
}

/** Panel between quantity and payment for products that ask questions. */
function answersView(order) {
  const product = order.product_id ? products.getProduct(order.product_id) : null;
  const qs = product ? products.questionsOf(product) : [];
  const embed = brand(COLORS.primary)
    .setTitle(`${e('order')} Order Details`)
    .setDescription(
      [
        ...heroLines('A few details are needed before we can deliver.'),
        quote(`${e('sparkle')} **${qs.length}** question(s) — asked once in a secure popup form.`),
        '',
        ...qs.map((q, i) => quote(`\`${String(i + 1).padStart(2, '0')}\`  ${plain(q.label).slice(0, 60)}`)),
        '',
        section(stepLine(product, 'details')),
        quote(`Press **Continue** and fill in the required information.`),
        quote(`${e('order')} Order ID ${DOT} \`${order.order_id}\``),
        '',
        section(`${e('more')} Order Progress`),
        ...progressTracker(order).split('\n'),
      ].join('\n')
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ord:ans:${order.order_id}`)
      .setLabel('Continue')
      .setEmoji(e('order'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ord:back:${order.order_id}`)
      .setLabel('Back')
      .setEmoji(e('back'))
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

/** Panel 6 — payment method picker. */
function paymentSelectView(order) {
  const active = methods.listActive();
  const product = order.product_id ? products.getProduct(order.product_id) : null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ord:pay:${order.order_id}`)
    // ── FIX: Discord renders select placeholders / labels / descriptions as
    //    PLAIN TEXT, so a custom-emoji tag (`<:Name:id>`) is shown literally
    //    (that is how `<:MekoFastMessage:…>` leaked into the payment picker).
    //    plain() strips emoji tags and collapses whitespace.
    .setPlaceholder(plain('Choose your payment method…'));

  if (active.length) {
    menu.addOptions(
      active.slice(0, 25).map((m) => {
        const emoji = eComp(m.key, m.emoji);
        const option = {
          label: plain(m.label).slice(0, 100) || 'Payment method',
          value: m.key,
          description: plain(m.instructions || `Pay with ${m.label}`).slice(0, 100),
        };
        // Never emit an empty emoji key — `emoji: ''` serialises to
        // `emoji: null`, which the API rejects.
        if (emoji) option.emoji = emoji;
        return option;
      })
    );
  } else {
    const emptyEmoji = eComp('cancelled');
    const option = { label: 'No payment methods configured', value: 'none' };
    if (emptyEmoji) option.emoji = emptyEmoji;
    menu.addOptions(option).setDisabled(true);
  }

  const embed = brand(COLORS.primary)
    .setTitle(`${e('card')} Choose Payment Method`)
    .setDescription(
      [
        ...heroLines('Pick how you would like to pay.'),
        quote(`${e('cart')} Product ${DOT} **${order.product_name}**`),
        quote(`${e('stock')} Quantity ${DOT} **${order.quantity}**`),
        quote(`${e('cash')} Total ${DOT} **${fmtMoney(order.total_price)}**`),
        '',
        section(stepLine(product, 'pay')),
        quote(`Choose a method from the menu below.`),
        active.length
          ? quote(`Payment details + QR appear on the next screen.`)
          : quote(`${e('warning')} No payment methods are configured yet — please contact staff.`),
        '',
        section(`${e('more')} Order Progress`),
        ...progressTracker(order).split('\n'),
      ].join('\n')
    );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ord:back:${order.order_id}`)
          .setLabel('Back')
          .setEmoji(e('back'))
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`ord:cx:${order.order_id}`)
          .setLabel('Cancel Order')
          .setEmoji(e('cancelled'))
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  };
}

function summaryEmbed(order) {
  const product = order.product_id ? products.getProduct(order.product_id) : null;
  const embed = brand(COLORS.primary)
    .setTitle(`${e('order')} Review & Confirm`)
    .setDescription(
      [
        ...heroLines('Please double-check everything before you confirm.'),
        quote(`${e('cart')} Product ${DOT} **${order.product_name}**`),
        quote(`${e('stock')} Quantity ${DOT} **${order.quantity}**`),
        quote(`${e('money')} Unit price ${DOT} ${fmtMoney(order.unit_price)}`),
        quote(`${e('cash')} **Total due ${DOT} ${fmtMoney(order.total_price)}**`),
        quote(`${e('card')} Payment ${DOT} ${orderViews.methodLabel(order)}`),
        quote(`${e('order')} Order ID ${DOT} \`${order.order_id}\``),
        ...orderViews.detailsBlock(order),
        '',
        section(stepLine(product, 'pay')),
        quote(`Confirm to receive the payment details.`),
        '',
        section(`${e('more')} Order Progress`),
        ...progressTracker(order).split('\n'),
      ].join('\n')
    );
  return embed;
}

function summaryRow(order) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ord:ok:${order.order_id}`)
        .setLabel('Confirm Order')
        .setEmoji(e('completed'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`ord:edit:${order.order_id}`)
        .setLabel('Edit')
        .setEmoji(e('order'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`ord:cx:${order.order_id}`)
        .setLabel('Cancel')
        .setEmoji(e('cancelled'))
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function summaryView(order) {
  return { embeds: [summaryEmbed(order)], components: summaryRow(order) };
}

/** Panel 7 — payment instructions with QR, copy button and "I've Paid". */
function paymentView(order) {
  const method = order.payment_method ? methods.get(order.payment_method) : null;
  const c = method ? methods.cfg(method) : {};
  const payeeId = c.upi_id || c.wallet || '';
  const product = order.product_id ? products.getProduct(order.product_id) : null;

  const embed = brand(COLORS.primary)
    .setTitle(`${e('card')} ${method ? `${method.label.toUpperCase()} ` : ''}PAYMENT`)
    .setDescription(
      [
        ...heroLines('Complete the payment, then upload your screenshot.'),
        quote(`${e('cash')} **AMOUNT DUE ${DOT} ${fmtMoney(order.total_price)}**`),
        quote(
          `${e('cart')} ${order.product_name} × ${order.quantity} ${DOT} ${e('card')} ${
            method ? method.label : order.payment_method || '—'
          }`
        ),
        '',
        section('Payment details'),
        payeeId
          ? quote(
              `${e('upi')} ${method && ['upi', 'upi2'].includes(method.key) ? 'UPI ID' : 'Wallet'} ${DOT} \`${payeeId}\``
            )
          : '',
        c.name ? quote(`${e('staff')} Payee ${DOT} ${c.name}`) : '',
        c.coin ? quote(`${e('bitcoin')} Coin ${DOT} ${c.coin}`) : '',
        c.network ? quote(`${e('delivery')} Network ${DOT} ${c.network}`) : '',
        payeeId ? quote(`${e('sparkle')} *Scan the QR below, or copy the ID with the button.*`) : '',
        '',
        section('How to finish'),
        quote(`Pay exactly **${fmtMoney(order.total_price)}** with this method`),
        quote(`Upload the **payment screenshot** in this ticket`),
        quote(`Our staff verifies it — usually within minutes`),
        '',
        quote(`${e('warning')} *Orders are processed only after staff verification.*`),
        quote(`Order ID ${DOT} \`${order.order_id}\``),
        quote(`Step ${DOT} ${stepLine(product, 'verify')}`),
        '',
        section(`${e('more')} Order Progress`),
        ...progressTracker(order).split('\n'),
      ]
        .filter(Boolean)
        .join('\n')
    );

  const files = [];
  const qrPath = path.join(config.qrDir, `${order.payment_method}.png`);
  if (fs.existsSync(qrPath)) {
    files.push(new AttachmentBuilder(qrPath).setName(`${order.payment_method}.png`));
    embed.setImage(`attachment://${order.payment_method}.png`);
  } else if (c.qr_url && /^https?:\/\//i.test(c.qr_url)) {
    embed.setImage(c.qr_url);
  }

  const buttons = [
    new ButtonBuilder()
      .setCustomId(`ord:paid:${order.order_id}`)
      .setLabel("I've Paid")
      .setEmoji(e('completed'))
      .setStyle(ButtonStyle.Success),
  ];
  if (payeeId) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`ord:copy:${order.order_id}`)
        .setLabel('Copy ID')
        .setEmoji(e('order'))
        .setStyle(ButtonStyle.Secondary)
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`ord:cx:${order.order_id}`)
      .setLabel('Cancel Order')
      .setEmoji(e('cancelled'))
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)], files };
}


function cancelledView(order) {
  const embed = brand(COLORS.danger)
    .setTitle(`${e('cancelled')} Order Cancelled`)
    .setDescription(
      [
        ...heroLines('This order is closed — no payment is required.'),
        quote(`${e('order')} Order ID ${DOT} \`${order.order_id}\``),
        quote(`${e('cart')} ${order.product_name}`),
        order.quantity ? quote(`${e('stock')} Quantity ${DOT} ${order.quantity}`) : '',
        '',
        quote(`${e('heart')} *Thanks for visiting **X SHOP** — you are welcome back anytime.*`),
      ]
        .filter(Boolean)
        .join('\n')
    );
  return { embeds: [embed], components: [] };
}

function confirmCancelView(order) {
  const embed = brand(COLORS.warning)
    .setTitle(`${e('cancelled')} Cancel This Order?`)
    .setDescription(
      [
        quote(`${e('order')} Order ID ${DOT} \`${order.order_id}\``),
        quote(`${e('cart')} ${order.product_name}`),
        '',
        quote(`Your private ticket will be closed and the order cannot be restored.`),
        quote(`**Yes, cancel it** — close everything now`),
        quote(`**No, go back** — keep ordering`),
      ].join('\n')
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ord:cxy:${order.order_id}`)
      .setLabel('Yes, cancel it')
      .setEmoji(e('completed'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ord:cxn:${order.order_id}`)
      .setLabel('No, go back')
      .setEmoji(e('back'))
      .setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

/**
 * Rebuild the correct step view for an order (used by Back / cancel-abort).
 * The quantity stepper persists its draft on the order row, so "confirmed"
 * quantity is detected by the quantity_selected event, not by quantity > 0.
 */
function viewForOrder(order, product) {
  const confirmed = orders.hasEvent(order.order_id, 'quantity_selected');
  if (!confirmed) return quantityView(order, product);
  if (!order.payment_method) {
    const questions = product ? products.questionsOf(product) : [];
    if (questions.length && !orders.answersOf(order).length) return answersView(order);
    return paymentSelectView(order);
  }
  return summaryView(order);
}

// ── Flow entry point ────────────────────────────────────────────────────────

/** A Discord permission error code (or null). */
const permCode = (err) => (err?.code === 50001 || err?.code === 50013 ? err.code : null);

/**
 * Send the ticket welcome — the ONLY hard requirement is the channel exists
 * and the bot can post in it.
 *
 * Hardened against three real-world failures:
 *   1. fresh overwrites not applied yet            → repair + retry (50001)
 *   2. the ticket vanished right after creation    → UNKNOWN CHANNEL → null
 *      (a moderation bot / manual cleanup deleted it)
 *   3. stale data raced the send                   → retry once
 *
 * Returns the posted message, or null when the channel is gone / unreachable.
 */
async function postWelcome(channel, order, product) {
  if (!channel) return null;

  // First repair anything the category can block, so the message can send.
  await ensureBotAccess(channel, channel.client ?? getClient());

  const payload = quantityView(order, product);
  try {
    const msg = await channel.send(payload);
    orders.update(order.order_id, { flow_message_id: msg.id });
    return msg;
  } catch (err) {
    const code = permCode(err);
    if (code === 50001 || code === 50013) {
      // Discord denied a brand-new channel — re-assert the bot overwrite once.
      await ensureBotAccess(channel, channel.client ?? getClient(), { retries: 1 });
      const retry = await channel.send(payload).catch(() => null);
      if (retry) {
        orders.update(order.order_id, { flow_message_id: retry.id });
        return retry;
      }
    }
    return null;
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

function validateQty(product, qty) {
  if (!Number.isInteger(qty) || qty < 1) return `${e('cancelled')} Invalid quantity.`;
  const min = Math.max(1, product.minimum_quantity || 1);
  const max = product.maximum_quantity || 10;
  if (qty < min) return `${e('cancelled')} Minimum quantity is **${min}**.`;
  if (qty > max) return `${e('cancelled')} Maximum quantity is **${max}**.`;
  if (product.stock !== -1 && qty > product.stock) return `${e('cancelled')} Only **${product.stock}** left in stock.`;
  return null;
}

/** Clamp + persist a stepper draft quantity; returns the fresh order or an error string. */
function setDraftQuantity(order, product, qty) {
  const min = Math.max(1, product.minimum_quantity || 1);
  const stockMax = product.stock === -1 ? Infinity : product.stock;
  const hardMax = Math.min(product.maximum_quantity || 10, stockMax);
  const clamped = Math.min(Math.max(Math.trunc(qty), min), hardMax);
  if (clamped !== qty) return { error: `${e('cancelled')} Quantity must be between **${min}** and **${hardMax}**.` };
  orders.update(order.order_id, { quantity: clamped, total_price: clamped * product.price });
  return { order: orders.getByOrderId(order.order_id) };
}

// ── Modals ──────────────────────────────────────────────────────────────────

function answersModal(order, questions) {
  const modal = new ModalBuilder()
    .setCustomId(`modal:ans:${order.order_id}`)
    .setTitle(`Details • ${order.product_name}`.slice(0, 45));
  questions.slice(0, 5).forEach((q, i) => {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i}`)
          .setLabel((q.label || `Question ${i + 1}`).slice(0, 45))
          .setStyle(q.style === 'long' ? TextInputStyle.Paragraph : TextInputStyle.Short)
          .setRequired(q.required !== false)
          .setPlaceholder(String(q.placeholder || '').slice(0, 100))
      )
    );
  });
  return modal;
}

function customQtyModal(order) {
  const modal = new ModalBuilder()
    .setCustomId(`modal:qty:${order.order_id}`)
    .setTitle('Custom Quantity'.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('qty')
        .setLabel('How many units?')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter a number')
    )
  );
  return modal;
}

// ── Component routing ───────────────────────────────────────────────────────

/**
 * Category chosen inside a Buy Now ticket — swaps the buy menu for that
 * category's product picker (ord:pick), which then creates the order.
 */
async function handleCategoryPick(interaction) {
  if (getSetting('maintenance') === '1') {
    return replyEphemeral(
      interaction,
      `${e('staff')} The shop is under maintenance right now. Please try again later.`
    );
  }
  const category = products.getCategory(Number(interaction.values[0]));
  if (!category || category.status !== 'active') {
    return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
  }
  const list = products.listProducts(category.id);
  if (!list.length) {
    return replyEphemeral(interaction, `${e('warning')} No products in this category yet.`);
  }
  return interaction.update(
    require('../shop/views').pickProductView(category, list, interaction.user.id)
  );
}

/**
 * Product chosen inside a category ticket — creates the order and swaps the
 * pick screen for the normal quantity stepper, so the rest of the flow
 * (questions → payment → verification → delivery) is exactly unchanged.
 */
async function handleProductPick(interaction) {
  if (getSetting('maintenance') === '1') {
    return replyEphemeral(
      interaction,
      `${e('staff')} The shop is under maintenance right now. Please try again later.`
    );
  }

  const product = products.getProduct(Number(interaction.values[0]));
  if (!product || product.status !== 'active' || product.stock === 0) {
    return replyEphemeral(interaction, `${e('warning')} This product is no longer available.`);
  }
  const category = products.getCategory(product.category_id);
  if (!category || category.status !== 'active') {
    return replyEphemeral(interaction, `${e('warning')} This category is no longer available.`);
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

  clearPendingPick(interaction.user.id);

  const channel = interaction.channel;
  const order = orders.createOrder(interaction.user, product);
  orders.update(order.order_id, { ticket_channel_id: channel.id, flow_message_id: interaction.message.id });
  orders.addEvent(order.order_id, 'order_created', interaction.user.id, channel.name);

  // Best-effort retitle — the ticket was opened under the category name.
  const slug = `${interaction.user.username}-${product.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  await channel.setName(`order-${slug}`).catch(() => {});

  return interaction.update(quantityView(order, product));
}

/** Leave a category ticket before ordering — closes the channel outright. */
async function handleLeaveTicket(interaction, openerId) {
  if (interaction.user.id !== openerId) return replyEphemeral(interaction, WRONG_USER);
  clearPendingPick(interaction.user.id);
  await interaction.deferUpdate();
  await interaction.channel.delete('X SHOP — customer left before ordering');
}

async function handleComponent(interaction) {
  const parts = interaction.customId.split(':'); // ['ord', action, orderId]
  const action = parts[1];

  // Pre-order actions — category tickets hold no order row yet.
  if (action === 'pick') return handleProductPick(interaction);
  if (action === 'pickcat') return handleCategoryPick(interaction);
  if (action === 'leave') return handleLeaveTicket(interaction, parts[2]);

  const order = orders.getByOrderId(parts[2]);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);
  if (interaction.user.id !== order.discord_user_id) return replyEphemeral(interaction, WRONG_USER);

  const product = order.product_id ? products.getProduct(order.product_id) : null;

  switch (action) {
    case 'qm':
    case 'qp': {
      if (!product) return replyEphemeral(interaction, `${e('warning')} Product unavailable.`);
      const min = Math.max(1, product.minimum_quantity || 1);
      const cur = order.quantity > 0 ? order.quantity : min;
      const target = action === 'qm' ? cur - 1 : cur + 1;
      const res = setDraftQuantity(order, product, target);
      if (res.error) return replyEphemeral(interaction, res.error);
      await interaction.deferUpdate();
      return interaction.editReply(quantityView(res.order, product));
    }

    case 'next': {
      if (!product) return replyEphemeral(interaction, `${e('warning')} Product unavailable.`);
      const qty = order.quantity > 0 ? order.quantity : Math.max(1, product.minimum_quantity || 1);
      const err = validateQty(product, qty);
      if (err) return replyEphemeral(interaction, err);
      orders.update(order.order_id, { quantity: qty, total_price: qty * product.price });
      orders.addEvent(order.order_id, 'quantity_selected', interaction.user.id, String(qty));
      const fresh = orders.getByOrderId(order.order_id);
      const questions = products.questionsOf(product);
      if (questions.length && !orders.answersOf(fresh).length) {
        return interaction.showModal(answersModal(fresh, questions));
      }
      await interaction.deferUpdate();
      return interaction.editReply(paymentSelectView(fresh));
    }

    case 'qtyc':
      return interaction.showModal(customQtyModal(order));

    case 'ans': {
      if (!product) return replyEphemeral(interaction, `${e('warning')} Product unavailable.`);
      const questions = products.questionsOf(product);
      if (!questions.length) return replyEphemeral(interaction, `${e('warning')} No details required.`);
      return interaction.showModal(answersModal(order, questions));
    }

    case 'back': {
      const fresh = orders.getByOrderId(order.order_id);
      return interaction.update(quantityView(fresh, product));
    }

    case 'pay': {
      const key = interaction.values[0];
      if (key === 'none') return replyEphemeral(interaction, `${e('warning')} No payment methods are configured yet.`);
      const method = methods.get(key);
      if (!method || method.status !== 'active') {
        return replyEphemeral(interaction, `${e('warning')} That payment method is unavailable.`);
      }
      orders.update(order.order_id, { payment_method: key });
      orders.setStatus(order.order_id, 'awaiting_payment', interaction.user.id, `Payment method: ${method.label}`);
      const fresh = orders.getByOrderId(order.order_id);
      await interaction.deferUpdate();
      await interaction.editReply(summaryView(fresh));
      await notifyOwner(orderViews.paymentSelectedEmbed(fresh));
      await orderLog(orderViews.paymentSelectedEmbed(fresh));
      return;
    }

    case 'ok': {
      if (!order.payment_method) return replyEphemeral(interaction, `${e('warning')} Please choose a payment method first.`);
      // Acknowledge the interaction BEFORE editing — editReply throws
      // InteractionNotReplied otherwise.
      await interaction.deferUpdate();
      await interaction.editReply(paymentView(order));
      return;
    }

    case 'paid': {
      if (!['awaiting_payment', 'payment_review'].includes(order.order_status) || !order.payment_method) {
        return replyEphemeral(interaction, `${e('warning')} This order is not waiting for payment.`);
      }
      orders.addEvent(order.order_id, 'customer_paid_ack', interaction.user.id);
      await interaction.reply({
        content: `${e('completed')} Great! Please **upload your payment screenshot** here in the ticket.`,
        flags: MessageFlags.Ephemeral,
      });
      await interaction.channel.send({ embeds: [orderViews.proofRequestEmbed(order)] });
      return;
    }

    case 'copy': {
      const method = order.payment_method ? methods.get(order.payment_method) : null;
      const c = method ? methods.cfg(method) : {};
      const payeeId = c.upi_id || c.wallet || '';
      if (!payeeId) return replyEphemeral(interaction, `${e('warning')} No payment ID is configured for this method.`);
      return replyEphemeral(
        interaction,
        `${e('order')} **${method ? method.label : 'Payment'} ID** — tap to copy:\n\`${payeeId}\``
      );
    }

    case 'edit':
      return interaction.update(quantityView(order, product));

    case 'cx':
      if (['processing', 'completed', 'refunded'].includes(order.order_status)) {
        return replyEphemeral(interaction, `${e('cancelled')} This order is already paid — please contact staff to cancel.`);
      }
      return interaction.update(confirmCancelView(order));

    case 'cxy': {
      if (['processing', 'completed', 'refunded'].includes(order.order_status)) {
        return replyEphemeral(interaction, `${e('cancelled')} This order is already paid — please contact staff to cancel.`);
      }
      orders.setStatus(order.order_id, 'cancelled', interaction.user.id, 'Cancelled by customer');
      const fresh = orders.getByOrderId(order.order_id);
      await interaction.update(cancelledView(fresh));
      await notifyOwner(orderViews.orderCancelledEmbed(fresh, interaction.user.id));
      await orderLog(orderViews.orderCancelledEmbed(fresh, interaction.user.id));
      setTimeout(() => {
        interaction.channel?.delete(`X SHOP order ${order.order_id} cancelled`).catch(() => {});
      }, 15_000);
      return;
    }

    case 'cxn': {
      const fresh = orders.getByOrderId(order.order_id);
      return interaction.update(viewForOrder(fresh, product));
    }

    default:
      return;
  }
}

// ── Modal handlers ──────────────────────────────────────────────────────────

async function handleCustomQtyModal(interaction) {
  const oid = interaction.customId.split(':')[2];
  const order = orders.getByOrderId(oid);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);
  if (interaction.user.id !== order.discord_user_id) return replyEphemeral(interaction, WRONG_USER);
  const product = products.getProduct(order.product_id);
  if (!product) return replyEphemeral(interaction, `${e('warning')} Product unavailable.`);

  const qty = parseInt(interaction.fields.getTextInputValue('qty').trim(), 10);
  const err = validateQty(product, qty);
  if (err) return replyEphemeral(interaction, err);

  orders.update(order.order_id, { quantity: qty, total_price: qty * product.price });
  const fresh = orders.getByOrderId(order.order_id);
  const questions = products.questionsOf(product);

  await interaction.deferUpdate();
  if (questions.length && !orders.answersOf(fresh).length) {
    return interaction.editReply(answersView(fresh));
  }
  return interaction.editReply(paymentSelectView(fresh));
}

async function handleAnswersModal(interaction) {
  const oid = interaction.customId.split(':')[2];
  const order = orders.getByOrderId(oid);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);
  if (interaction.user.id !== order.discord_user_id) return replyEphemeral(interaction, WRONG_USER);
  const product = products.getProduct(order.product_id);
  const questions = products.questionsOf(product);

  const answers = [];
  for (let i = 0; i < questions.length; i++) {
    const value = interaction.fields.fields.get(`q${i}`)?.value?.trim() || '';
    answers.push({ label: questions[i].label, value: value.slice(0, 1024) });
  }

  orders.update(order.order_id, { answers: JSON.stringify(answers) });
  orders.addEvent(order.order_id, 'details_submitted', interaction.user.id);
  const fresh = orders.getByOrderId(order.order_id);

  await interaction.deferUpdate();
  return interaction.editReply(paymentSelectView(fresh));
}

// ── Payment proof detection ─────────────────────────────────────────────────

async function onTicketMessage(message) {
  if (message.author.bot) return;
  const order = orders.getByChannel(message.channel.id);
  if (!order) return;
  if (message.author.id !== order.discord_user_id) return; // staff messages are not proofs
  if (!['awaiting_payment', 'payment_review'].includes(order.order_status)) return;

  const image = message.attachments.find(
    (a) => a.contentType && a.contentType.startsWith('image/')
  );
  if (!image) return;

  if (onCooldown(`proof:${message.author.id}`, config.proofCooldownMs)) return;

  orders.update(order.order_id, { payment_proof_url: image.url, payment_status: 'pending_review' });
  orders.setStatus(order.order_id, 'payment_review', message.author.id, 'Payment proof uploaded');
  const fresh = orders.getByOrderId(order.order_id);

  await message.channel.send({ embeds: [orderViews.proofReceivedCustomer(fresh)] });

  // The review panel is staff-only: it goes to the owner DMs and/or the
  // dedicated review channel — never into the customer's ticket. Re-posting
  // retires the previous panel so the newest proof is the live one.
  const sent = await reviewPanel.postReviewPanel(fresh);
  if (!sent.ok) {
    await errorLog(
      'review-panel',
      new Error(
        `No review destination for ${fresh.order_id} — set ORDER_REVIEW_CHANNEL_ID or open owner DMs.`
      )
    );
  }

  await notifyOwner(orderViews.proofUploadedEmbed(fresh));
  await paymentLog(orderViews.proofUploadedEmbed(fresh));
}

module.exports = {
  postWelcome,
  handleComponent,
  handleCustomQtyModal,
  handleAnswersModal,
  onTicketMessage,
  quantityView,
  viewForOrder,
  paymentSelectView,
  setPendingPick,
  clearPendingPick,
  getPendingPickChannel,
};
