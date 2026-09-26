'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const orders = require('../orders/orders');
const products = require('../products/products');
const methods = require('../payments/methods');
const { brand, COLORS, BULLET, DOT, fmtMoney, statusLine, ORDER_STATUS, lead, e, eMaybe } = require('../utils/embeds');
const { canStaffAct } = require('../utils/perms');
const { replyEphemeral } = require('../utils/interactions');
const { notifyOwner } = require('../services/notify');
const { orderLog, paymentLog, staffLog } = require('../services/logs');
const orderViews = require('../services/orderViews');
const reviewPanel = require('../services/reviewPanel');
const { fetchTicketChannel } = require('./create');

// ── Staff panel ─────────────────────────────────────────────────────────────

function panelEmbed(order) {
  const st = ORDER_STATUS[order.order_status] || ORDER_STATUS.pending;
  const method = order.payment_method ? methods.get(order.payment_method) : null;
  const underReview = order.order_status === 'payment_review';
  return brand(st.color)
    .setTitle(`${e('star')} Payment Review ${BULLET} ${order.product_name}`)
    .setDescription(
      [
        `${e('order')} **Order** ${BULLET} \`${order.order_id}\``,
        `${e('cart')} **Product** ${BULLET} ${order.product_name} × ${order.quantity || 1}`,
        `${e('money')} **Amount** ${BULLET} **${fmtMoney(order.total_price)}**`,
        `${e('card')} **Method** ${BULLET} ${
          method ? lead(eMaybe(method.label, method.emoji), method.label) : order.payment_method || '—'
        }`,
        `${e('star')} **Proof** ${BULLET} ${
          order.payment_proof_url ? `[Open screenshot](${order.payment_proof_url})` : 'Not submitted'
        }`,
        '',
        `${e('staff')} **Customer** ${BULLET} <@${order.discord_user_id}> ${DOT} \`${order.discord_user_id}\``,
        `${e('ticket')} **Ticket** ${BULLET} ${
          order.ticket_channel_id ? `<#${order.ticket_channel_id}>` : '—'
        }`,
        `**Status** ${BULLET} ${underReview ? `${e('pending')} Under review` : statusLine(order.order_status)}`,
        order.verified_by ? `**Verified by** ${BULLET} <@${order.verified_by}>` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setTimestamp();
}

function panelRows(order) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stf:approve:${order.order_id}`)
        .setLabel('Approve')
        .setEmoji(e('completed'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`stf:reject:${order.order_id}`)
        .setLabel('Reject')
        .setEmoji(e('cancelled'))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`stf:reproof:${order.order_id}`)
        .setLabel('Request New Proof')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`stf:deliver:${order.order_id}`)
        .setLabel('Mark Delivered')
        .setEmoji(e('delivery'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`stf:note:${order.order_id}`)
        .setLabel('Staff Note')
        .setEmoji(e('order'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`stf:info:${order.order_id}`)
        .setLabel('Order Info')
        .setEmoji(e('review'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`stf:pay:${order.order_id}`)
        .setLabel('Payment')
        .setEmoji(e('card'))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`stf:close:${order.order_id}`)
        .setLabel('Close Ticket')
        .setEmoji(e('lock'))
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ── Modals ──────────────────────────────────────────────────────────────────

function reasonModal(mode, orderId, title) {
  const modal = new ModalBuilder().setCustomId(`modal:rej:${mode}:${orderId}`).setTitle(title.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason (optional, shown to customer)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Leave empty for no reason')
    )
  );
  return modal;
}

function noteModal(orderId) {
  const modal = new ModalBuilder().setCustomId(`modal:note:${orderId}`).setTitle('Staff Note'.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Internal note (customers never see this)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
    )
  );
  return modal;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Send a customer-facing embed into the order's ticket. Never touches the
 * review-panel destination, and is a no-op when the ticket is already gone.
 */
async function tellTicket(order, embed) {
  const channel = await fetchTicketChannel(order);
  if (!channel) return false;
  try {
    await channel.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

/** Mark an order completed: status, stock, customer message, notifications. */
async function completeOrder(order, actorId) {
  orders.setStatus(order.order_id, 'completed', actorId, 'Order delivered');
  orders.update(order.order_id, { completed_at: new Date().toISOString().slice(0, 19).replace('T', ' ') });
  if (order.product_id) products.decrementStock(order.product_id, order.quantity || 0);
  const fresh = orders.getByOrderId(order.order_id);

  await tellTicket(fresh, orderViews.orderCompletedCustomer(fresh));
  await reviewPanel.refreshReviewPanel(fresh);
  await notifyOwner(orderViews.orderCompletedLog(fresh, actorId));
  await orderLog(orderViews.orderCompletedLog(fresh, actorId));
  await staffLog(orderViews.staffActionEmbed('ORDER DELIVERED', fresh, actorId));
  return fresh;
}

/**
 * Shared with the !close command. Cancels live orders, retires the review
 * panel (it lives outside the ticket) and deletes the ticket channel.
 */
async function closeTicket(order, actorId, reason) {
  if (!['completed', 'cancelled', 'refunded'].includes(order.order_status)) {
    orders.setStatus(order.order_id, 'cancelled', actorId, reason || 'Ticket closed by staff');
  } else {
    orders.addEvent(order.order_id, 'ticket_closed', actorId, reason || null);
  }
  await staffLog(orderViews.staffActionEmbed('TICKET CLOSED', order, actorId, reason));
  await reviewPanel.removeReviewPanel(order);

  const channel = await fetchTicketChannel(order);
  if (channel) {
    setTimeout(() => {
      channel.delete(`X SHOP order ${order.order_id} closed`).catch(() => {});
    }, 4000);
  }
}

// ── Component routing ───────────────────────────────────────────────────────

// Actions that make no sense once an order is finished (the review panel can
// outlive the ticket, so stale buttons must be refused).
const CLOSED_ACTIONS = ['approve', 'deliver', 'dely', 'reject', 'reproof'];

async function handleComponent(interaction) {
  // Works in DMs too (owner-only there), where interaction.member is null.
  if (!canStaffAct(interaction)) {
    return replyEphemeral(interaction, `${e('cancelled')} Staff only.`);
  }

  const parts = interaction.customId.split(':'); // ['stf', action, orderId]
  const action = parts[1];
  const order = orders.getByOrderId(parts[2]);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);

  if (
    ['completed', 'cancelled', 'refunded'].includes(order.order_status) &&
    CLOSED_ACTIONS.includes(action)
  ) {
    return replyEphemeral(
      interaction,
      `${e('warning')} Order \`${order.order_id}\` is already **${order.order_status}** — no further action needed.`
    );
  }

  switch (action) {
    case 'info': {
      const events = orders.eventsFor(order.order_id, 8);
      return interaction.reply({
        embeds: [orderViews.orderInfoEmbed(order, events)],
        flags: MessageFlags.Ephemeral,
      });
    }

    case 'pay':
      return interaction.reply({
        embeds: [orderViews.paymentInfoEmbed(order)],
        flags: MessageFlags.Ephemeral,
      });

    case 'approve': {
      if (order.payment_status === 'verified') {
        return replyEphemeral(interaction, `${e('completed')} Payment is already verified.`);
      }
      if (!order.payment_proof_url) {
        return replyEphemeral(interaction, `${e('warning')} No payment proof has been submitted yet.`);
      }
      orders.update(order.order_id, { payment_status: 'verified', verified_by: interaction.user.id });
      orders.setStatus(order.order_id, 'processing', interaction.user.id, 'Payment approved');
      const fresh = orders.getByOrderId(order.order_id);
      await interaction.update({ embeds: [panelEmbed(fresh)], components: panelRows(fresh) });
      await tellTicket(fresh, orderViews.paymentVerifiedCustomer(fresh));
      await notifyOwner(orderViews.paymentApprovedEmbed(fresh));
      await paymentLog(orderViews.paymentApprovedEmbed(fresh));
      await staffLog(orderViews.staffActionEmbed('PAYMENT APPROVED', fresh, interaction.user.id));
      return;
    }

    case 'reject':
      return interaction.showModal(reasonModal('reject', order.order_id, 'Reject Payment'));

    case 'reproof':
      return interaction.showModal(reasonModal('reproof', order.order_id, 'Request New Proof'));

    case 'deliver': {
      if (order.order_status !== 'processing') {
        return replyEphemeral(interaction, `${e('warning')} Approve the payment before marking delivered.`);
      }
      const embed = brand(COLORS.warning)
        .setTitle(`${e('delivery')} CONFIRM DELIVERY`)
        .setDescription([
          'Are you sure you want to mark this order as delivered?',
          '',
          `${e('order')} Order ID: \`${order.order_id}\``,
        ].join('\n'));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stf:dely:${order.order_id}`)
          .setLabel('Confirm Delivery')
          .setEmoji(e('completed'))
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`stf:deln:${order.order_id}`)
          .setLabel('Cancel')
          .setEmoji(e('cancelled'))
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    case 'dely': {
      await interaction.update({ content: `${e('delivery')} Marking order as delivered…`, embeds: [], components: [] });
      await completeOrder(order, interaction.user.id);
      return;
    }

    case 'deln':
      return interaction.update({ content: 'Delivery cancelled.', embeds: [], components: [] });

    case 'note':
      return interaction.showModal(noteModal(order.order_id));

    case 'close': {
      const embed = brand(COLORS.danger)
        .setTitle(`${e('lock')} CLOSE TICKET?`)
        .setDescription([
          'Are you sure you want to close this ticket?',
          '',
          `${e('order')} Order ID: \`${order.order_id}\``,
        ].join('\n'));
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`stf:closey:${order.order_id}`)
          .setLabel('Close Ticket')
          .setEmoji(e('lock'))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`stf:closen:${order.order_id}`)
          .setLabel('Cancel')
          .setEmoji(e('cancelled'))
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    }

    case 'closey': {
      await interaction.update({ content: `${e('lock')} Closing ticket…`, embeds: [], components: [] });
      await closeTicket(order, interaction.user.id, 'Closed from the review panel');
      return;
    }

    case 'closen':
      return interaction.update({ content: 'Ticket kept open.', embeds: [], components: [] });

    default:
      return;
  }
}

// ── Modal handlers ──────────────────────────────────────────────────────────

async function handleRejectModal(interaction) {
  // Owners act from their DMs, where interaction.member is null.
  if (!canStaffAct(interaction)) return replyEphemeral(interaction, `${e('cancelled')} Staff only.`);

  const [, , mode, oid] = interaction.customId.split(':');
  const order = orders.getByOrderId(oid);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);

  const reason = interaction.fields.getTextInputValue('reason').trim().slice(0, 1000);

  if (mode === 'reject') {
    orders.update(order.order_id, { payment_status: 'rejected', payment_proof_url: null });
    orders.setStatus(order.order_id, 'awaiting_payment', interaction.user.id, `Payment rejected${reason ? `: ${reason}` : ''}`);
    const fresh = orders.getByOrderId(order.order_id);
    await interaction.update({ embeds: [panelEmbed(fresh)], components: panelRows(fresh) });
    await tellTicket(fresh, orderViews.paymentNotVerifiedCustomer(fresh, reason));
    await notifyOwner(orderViews.paymentRejectedEmbed(fresh, reason, interaction.user.id));
    await paymentLog(orderViews.paymentRejectedEmbed(fresh, reason, interaction.user.id));
    await staffLog(orderViews.staffActionEmbed('PAYMENT REJECTED', fresh, interaction.user.id, reason));
    return;
  }

  // reproof
  orders.update(order.order_id, { payment_proof_url: null });
  orders.setStatus(order.order_id, 'awaiting_payment', interaction.user.id, 'Staff requested new proof');
  const fresh = orders.getByOrderId(order.order_id);
  await interaction.update({ embeds: [panelEmbed(fresh)], components: panelRows(fresh) });
  await tellTicket(fresh, orderViews.reproofCustomer(fresh, interaction.user.id));
  await notifyOwner(orderViews.reproofRequestedEmbed(fresh, interaction.user.id));
  await paymentLog(orderViews.reproofRequestedEmbed(fresh, interaction.user.id));
  await staffLog(orderViews.staffActionEmbed('NEW PROOF REQUESTED', fresh, interaction.user.id, reason));
}

async function handleNoteModal(interaction) {
  if (!canStaffAct(interaction)) return replyEphemeral(interaction, `${e('cancelled')} Staff only.`);

  const oid = interaction.customId.split(':')[2];
  const order = orders.getByOrderId(oid);
  if (!order) return replyEphemeral(interaction, `${e('warning')} This order no longer exists.`);

  const text = interaction.fields.getTextInputValue('note').trim().slice(0, 1000);
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const entry = `[${stamp} • ${interaction.user.tag}] ${text}`;
  const prev = order.staff_note ? `${order.staff_note}\n` : '';
  orders.update(order.order_id, { staff_note: (prev + entry).slice(0, 4000) });
  orders.addEvent(order.order_id, 'staff_note', interaction.user.id, text.slice(0, 200));

  await replyEphemeral(interaction, `${e('order')} Note saved. Staff notes are never visible to customers.`);
  await staffLog(orderViews.staffActionEmbed('STAFF NOTE', order, interaction.user.id, text));
}

module.exports = {
  panelEmbed,
  panelRows,
  handleComponent,
  handleRejectModal,
  handleNoteModal,
  completeOrder,
  closeTicket,
};
