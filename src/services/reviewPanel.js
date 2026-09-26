'use strict';

/**
 * Staff payment-review panel delivery.
 *
 * The Approve / Reject / Request-proof panel is STAFF-ONLY, so it is never
 * posted inside the customer's ticket — the customer only ever sees their own
 * "proof received / verified / delivered" messages. The destination is set in
 * .env:
 *
 *   ORDER_REVIEW_TARGET      dm | channel | both   (default dm = owner DMs)
 *   ORDER_REVIEW_CHANNEL_ID  channel used by `channel` / `both`
 *
 * The order row remembers where the panel went (`review_channel_id` +
 * `staff_panel_message_id`) so actions can refresh it or retire it later.
 */

const config = require('../config/config');
const orders = require('../orders/orders');
const { getClient } = require('./logs');

/** Panel payload — required lazily so tickets/staff.js can require this file. */
function panelPayload(order) {
  const { panelEmbed, panelRows } = require('../tickets/staff');
  return { embeds: [panelEmbed(order)], components: panelRows(order) };
}

/** Configured destination: owner DMs, a dedicated channel, or both. */
function destination() {
  const { target, channelId } = config.review;
  const wantsChannel = target === 'channel' || target === 'both';
  return {
    dm: target === 'dm' || target === 'both',
    channelId: wantsChannel ? channelId || null : null,
  };
}

/**
 * The channel the stored panel lives in. Legacy rows (panel still in a ticket)
 * fall back to the ticket channel before the migration touched them.
 */
async function panelChannel(order) {
  const client = getClient();
  if (!client || !order || !order.staff_panel_message_id) return null;
  const channelId = order.review_channel_id || order.ticket_channel_id;
  if (!channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    return channel && channel.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

const forgetPanel = (orderId) =>
  orders.update(orderId, { staff_panel_message_id: null, review_channel_id: null });

/** Edit the existing panel in place (after a staff action). Best effort. */
async function refreshReviewPanel(order) {
  const channel = await panelChannel(order);
  if (!channel) return false;
  try {
    const msg = await channel.messages.fetch(order.staff_panel_message_id);
    await msg.edit(panelPayload(order));
    return true;
  } catch {
    forgetPanel(order.order_id);
    return false;
  }
}

/** Delete the stored panel (before re-posting, or when the order ends). */
async function removeReviewPanel(order) {
  const channel = await panelChannel(order);
  if (!channel) {
    if (order && order.staff_panel_message_id) forgetPanel(order.order_id);
    return false;
  }
  try {
    const msg = await channel.messages.fetch(order.staff_panel_message_id);
    await msg.delete();
  } catch {
    /* already gone */
  }
  forgetPanel(order.order_id);
  return true;
}

/**
 * Deliver the review panel to its configured destination and remember where.
 * Returns { ok, where[] }; `ok: false` means nothing could be delivered (for
 * example every owner has DMs closed) — callers should log that.
 */
async function postReviewPanel(order, { replace = true } = {}) {
  const client = getClient();
  if (!client || !order) return { ok: false, where: [] };

  if (replace) await removeReviewPanel(order);

  const { dm, channelId } = destination();
  const payload = panelPayload(order);
  const where = [];
  let stored = null;

  if (channelId) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const msg = await channel.send(payload);
        stored = { review_channel_id: channel.id, staff_panel_message_id: msg.id };
        where.push(`#${channel.name || channel.id}`);
      }
    } catch {
      /* channel missing or no permission */
    }
  }

  if (dm) {
    // Sequential so the first delivered copy becomes the one we refresh later.
    for (const ownerId of config.ownerIds) {
      try {
        const user = await client.users.fetch(ownerId);
        const msg = await user.send(payload);
        where.push(`DM ${ownerId}`);
        if (!stored) {
          stored = { review_channel_id: msg.channelId || null, staff_panel_message_id: msg.id };
        }
      } catch {
        /* owner has DMs closed — keep trying the others */
      }
    }
  }

  if (stored) orders.update(order.order_id, stored);
  return { ok: where.length > 0, where };
}

module.exports = {
  postReviewPanel,
  refreshReviewPanel,
  removeReviewPanel,
  panelPayload,
  destination,
};
