'use strict';

/**
 * Shared embed builders for the order lifecycle — used by the customer flow,
 * the staff panel, owner DM notifications and the log channels.
 */

const {
  brand,
  COLORS,
  fmtMoney,
  statusLine,
  BULLET,
  heroLines,
  e,
  eMaybe,
  lead,
  quote,
} = require('../utils/embeds');
const { answersOf } = require('../orders/orders');
const methods = require('../payments/methods');

function methodLabel(order) {
  const m = order.payment_method ? methods.get(order.payment_method) : null;
  return m ? lead(eMaybe(m.label, m.emoji), m.label) : (order.payment_method || '-');
}

function detailsBlock(order) {
  const answers = answersOf(order);
  if (!answers.length) return [];
  return ['', lead(e('order'), '**Order Details**'), ...answers.map((a) => quote(`${a.label}: ${a.value}`))];
}

/** Premium order summary rows — every owner/staff notification uses this. */
function fullOrderBlock(order, channel) {
  const ticketRef =
    order.ticket_channel_id && channel?.guild
      ? `<#${order.ticket_channel_id}>`
      : order.ticket_channel_id
        ? `<#${order.ticket_channel_id}>`
        : channel
          ? `#${channel.name}`
          : '—';

  return [
    `${e('order')} **Order** ${BULLET} \`${order.order_id}\``,
    `${e('cart')} **Product** ${BULLET} ${order.product_name} × ${order.quantity || '—'}`,
    `${e('money')} **Unit price** ${BULLET} ${fmtMoney(order.unit_price)}`,
    `${e('cash')} **Total** ${BULLET} **${fmtMoney(order.total_price)}**`,
    `${e('card')} **Payment** ${BULLET} ${methodLabel(order)}`,
    `${e('ticket')} **Ticket** ${BULLET} ${ticketRef}`,
    `**Status** ${BULLET} ${statusLine(order.order_status)}`,
    ...detailsBlock(order),
    order.payment_proof_url ? `\n${e('star')} **Proof** ${BULLET} ${order.payment_proof_url}` : '',
  ].filter(Boolean);
}

function baseOrderBlock(order) {
  return [
    `${e('order')} **Order** ${BULLET} \`${order.order_id}\``,
    `${e('cart')} **Product** ${BULLET} ${order.product_name} × ${order.quantity || '—'}`,
    `${e('cash')} **Total** ${BULLET} ${fmtMoney(order.total_price)}`,
    `${e('card')} **Payment** ${BULLET} ${methodLabel(order)}`,
    `**Status** ${BULLET} ${statusLine(order.order_status)}`,
  ];
}

// ── Owner / staff notifications ─────────────────────────────────────────────

function newOrderEmbed(order, channel) {
  return brand(COLORS.warning)
    .setTitle(`${e('bell')} NEW ORDER`)
    .setDescription(
      [
        `${e('sparkle')} **A customer just placed an order!**`,
        '',
        `**Customer:** <@${order.discord_user_id}>`,
        `**User ID:** \`${order.discord_user_id}\``,
        '',
        ...fullOrderBlock(order, channel),
      ].join('\n')
    );
}

function paymentSelectedEmbed(order) {
  return brand(COLORS.info)
    .setTitle(`${e('card')} PAYMENT METHOD SELECTED`)
    .setDescription(
      [
        `**Customer:** <@${order.discord_user_id}>`,
        '',
        ...fullOrderBlock(order),
      ].join('\n')
    );
}

function proofUploadedEmbed(order) {
  return brand(COLORS.warning)
    .setTitle(`${e('review')} PAYMENT PROOF UPLOADED`)
    .setDescription(
      [
        `**Customer:** <@${order.discord_user_id}>`,
        '',
        ...fullOrderBlock(order),
        '',
        `${e('warning')} Awaiting staff verification.`,
      ].join('\n')
    );
}

function paymentApprovedEmbed(order) {
  return brand(COLORS.success)
    .setTitle(`${e('completed')} PAYMENT APPROVED`)
    .setDescription(
      [`**Verified By:** <@${order.verified_by}>`, '', ...fullOrderBlock(order)].join('\n')
    );
}

function paymentRejectedEmbed(order, reason, actorId) {
  return brand(COLORS.danger)
    .setTitle(`${e('cancelled')} PAYMENT REJECTED`)
    .setDescription(
      [
        `**Rejected By:** <@${actorId}>`,
        '',
        ...fullOrderBlock(order),
        ...(reason ? ['', `**Reason:** ${reason}`] : []),
      ].join('\n')
    );
}

function reproofRequestedEmbed(order, actorId) {
  return brand(COLORS.warning)
    .setTitle(`${e('review')} NEW PROOF REQUESTED`)
    .setDescription(
      [`**Requested By:** <@${actorId}>`, '', ...fullOrderBlock(order)].join('\n')
    );
}

function orderCancelledEmbed(order, actorId) {
  return brand(COLORS.danger)
    .setTitle(`${e('cancelled')} ORDER CANCELLED`)
    .setDescription(
      [
        actorId ? `**Cancelled By:** <@${actorId}>` : '',
        '',
        ...fullOrderBlock(order),
      ]
        .filter(Boolean)
        .join('\n')
    );
}

function orderCompletedLog(order, actorId) {
  return brand(COLORS.success)
    .setTitle('✦ ORDER COMPLETED')
    .setDescription(
      [
        `**Verified By:** <@${order.verified_by || actorId}>`,
        '',
        ...fullOrderBlock(order),
        '',
        '**Completed:** Today',
      ].join('\n')
    );
}

function staffActionEmbed(action, order, actorId, note) {
  return brand(COLORS.violet)
    .setTitle(`${e('staff')} STAFF ACTION — ${action}`)
    .setDescription(
      [
        `**Staff:** <@${actorId}>`,
        '',
        ...fullOrderBlock(order),
        ...(note ? ['', `**Note:** ${note}`] : []),
      ].join('\n')
    );
}

// ── Customer-facing embeds ──────────────────────────────────────────────────

function proofReceivedCustomer(order) {
  return brand(COLORS.warning)
    .setTitle(`${e('completed')} Payment Proof Received`)
    .setDescription(
      [
        ...heroLines('Your screenshot is in — thanks!'),
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        `**Status** ${BULLET} ${e('pending')} Under review`,
        '',
        `${e('staff')} *Our staff verifies your payment — you can relax, we will post the result right here.*`,
      ].join('\n')
    )
    .setTimestamp();
}

function paymentVerifiedCustomer(order) {
  return brand(COLORS.success)
    .setTitle(`${e('completed')} Payment Verified`)
    .setDescription(
      [
        ...heroLines('Payment confirmed — your order is being prepared.'),
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        `${e('cart')} ${order.product_name} × ${order.quantity || '—'}`,
        `**Status** ${BULLET} ${e('processing')} Processing`,
        '',
        `${e('delivery')} *Delivery details will be posted in this ticket shortly.*`,
      ].join('\n')
    )
    .setTimestamp();
}

function paymentNotVerifiedCustomer(order, reason) {
  return brand(COLORS.danger)
    .setTitle(`${e('cancelled')} Payment Not Verified`)
    .setDescription(
      [
        ...heroLines('We could not verify that payment.'),
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        reason ? `${e('star')} **Reason** ${BULLET} ${reason}` : '',
        '',
        `${BULLET} Upload a **valid payment screenshot** in this ticket, or`,
        `${BULLET} Ask our staff — we will help you sort it out`,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setTimestamp();
}

function reproofCustomer(order, actorId) {
  return brand(COLORS.warning)
    .setTitle(`${e('review')} New Proof Requested`)
    .setDescription(
      [
        ...heroLines('Our team needs another payment proof.'),
        `${e('staff')} Requested by ${BULLET} <@${actorId}>`,
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        '',
        `${BULLET} Attach the **payment screenshot** in this ticket`,
      ].join('\n')
    )
    .setTimestamp();
}

function orderCompletedCustomer(order) {
  return brand(COLORS.success)
    .setTitle(`${e('completed')} Order Delivered`)
    .setDescription(
      [
        ...heroLines('All done — your order is complete.'),
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        `${e('cart')} ${order.product_name} × ${order.quantity || '—'}`,
        `**Status** ${BULLET} ${e('completed')} Completed`,
        '',
        `${e('heart')} *Thanks for shopping with **X SHOP** — enjoy!*`,
      ].join('\n')
    )
    .setTimestamp();
}

function proofRequestEmbed(order) {
  return brand(COLORS.primary)
    .setTitle(`${e('star')} Upload Payment Proof`)
    .setDescription(
      [
        ...heroLines('One last step: send us the payment screenshot.'),
        `${e('order')} Order ${BULLET} \`${order.order_id}\``,
        `**Status** ${BULLET} ${e('pending')} Awaiting proof`,
        '',
        `${BULLET} Attach the **screenshot** as an image in this ticket`,
        `${BULLET} We verify it, then deliver right after`,
      ].join('\n')
    )
    .setTimestamp();
}

function orderInfoEmbed(order, events) {
  const evLines = events.map((e) => `• \`${e.event}\`${e.note ? ` — ${e.note}` : ''} <t:${Math.floor(new Date(e.created_at.replace(' ', 'T') + 'Z').getTime() / 1000)}:R>`);
  return brand(COLORS.dark)
    .setTitle(`${e('review')} ORDER INFO — ${order.order_id}`)
    .setDescription(
      [
        ...baseOrderBlock(order),
        '',
        quote(`**Customer:** <@${order.discord_user_id}> (\`${order.discord_user_id}\`)`),
        quote(`**Payment Status:** ${order.payment_status}`),
        quote(`**Proof:** ${order.payment_proof_url || '—'}`),
        quote(`**Created:** ${order.created_at}`),
        quote(`**Completed:** ${order.completed_at || '—'}`),
        ...detailsBlock(order),
        '',
        `${e('order')} **Staff Notes**\n${order.staff_note || 'None'}`,
        '',
        `${e('order')} **Recent Events**\n${evLines.length ? evLines.join('\n') : '—'}`,
      ].join('\n')
    );
}

function paymentInfoEmbed(order) {
  const m = order.payment_method ? methods.get(order.payment_method) : null;
  const c = m ? methods.cfg(m) : {};
  const lines = Object.entries(c).map(([k, v]) => quote(`**${k}:** \`${v}\``));
  return brand(COLORS.dark)
    .setTitle(`${e('card')} PAYMENT INFO — ${order.order_id}`)
    .setDescription(
      [
        `**Method:** ${m ? lead(eMaybe(m.label, m.emoji), m.label) : (order.payment_method || '-')}`,
        lines.length ? '' : '*No configuration set for this method.*',
        ...lines,
        '',
        quote(`**Proof:** ${order.payment_proof_url || 'Not submitted'}`),
      ].join('\n')
    );
}

module.exports = {
  methodLabel,
  newOrderEmbed,
  paymentSelectedEmbed,
  proofUploadedEmbed,
  paymentApprovedEmbed,
  paymentRejectedEmbed,
  reproofRequestedEmbed,
  orderCancelledEmbed,
  orderCompletedLog,
  staffActionEmbed,
  proofReceivedCustomer,
  paymentVerifiedCustomer,
  paymentNotVerifiedCustomer,
  reproofCustomer,
  orderCompletedCustomer,
  proofRequestEmbed,
  orderInfoEmbed,
  paymentInfoEmbed,
  detailsBlock,
};
