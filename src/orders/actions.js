'use strict';

/**
 * Order actions shared by the web dashboard.
 *
 * Every action mirrors the Discord staff panel exactly: database update +
 * status history + owner notification + log channels + a message inside the
 * customer's private ticket, so the customer experience is identical no matter
 * whether staff clicked a button in Discord or a button on the dashboard.
 */

const orders = require('./orders');
const products = require('../products/products');
const { notifyOwner } = require('../services/notify');
const { orderLog, paymentLog, staffLog, getClient } = require('../services/logs');
const orderViews = require('../services/orderViews');

const TERMINAL = ['completed', 'cancelled', 'refunded'];
const STATUSES = [
  'pending',
  'awaiting_payment',
  'payment_review',
  'processing',
  'completed',
  'cancelled',
  'refunded',
];
const ACTOR = 'web-dashboard';

const stamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** Send embeds into the order's private ticket channel (best-effort). */
async function tellTicket(order, payload) {
  const client = getClient();
  if (!client || !order.ticket_channel_id) return false;
  try {
    const channel = await client.channels.fetch(order.ticket_channel_id);
    if (!channel || !channel.isTextBased()) return false;
    await channel.send(Array.isArray(payload) ? { embeds: payload } : payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refresh the staff review panel wherever it lives (owner DM or the dedicated
 * review channel — never the customer ticket). Best effort.
 */
async function refreshTicketPanel(order) {
  return require('../services/reviewPanel').refreshReviewPanel(order);
}

const fresh = (orderId) => orders.getByOrderId(orderId);

/** ✅ Verify payment → PROCESSING. */
async function approve(orderId, actorId = ACTOR) {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.payment_status === 'verified') return { ok: false, error: 'Payment is already verified.' };
  if (!order.payment_proof_url) {
    return { ok: false, error: 'No payment proof has been submitted yet.' };
  }

  orders.update(order.order_id, { payment_status: 'verified', verified_by: actorId });
  orders.setStatus(order.order_id, 'processing', actorId, 'Payment approved (dashboard)');
  const o = fresh(orderId);
  await tellTicket(o, orderViews.paymentVerifiedCustomer(o));
  await notifyOwner(orderViews.paymentApprovedEmbed(o));
  await paymentLog(orderViews.paymentApprovedEmbed(o));
  await staffLog(orderViews.staffActionEmbed('PAYMENT APPROVED', o, actorId, 'via web dashboard'));
  return { ok: true, order: o, message: `Payment verified — ${orderId} is now PROCESSING.` };
}

/** ❌ Reject payment (optional customer-visible reason). */
async function reject(orderId, actorId = ACTOR, reason = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };

  orders.update(order.order_id, { payment_status: 'rejected', payment_proof_url: null });
  orders.setStatus(
    order.order_id,
    'awaiting_payment',
    actorId,
    `Payment rejected${reason ? `: ${reason}` : ''} (dashboard)`
  );
  const o = fresh(orderId);
  await tellTicket(o, orderViews.paymentNotVerifiedCustomer(o, reason));
  await notifyOwner(orderViews.paymentRejectedEmbed(o, reason, actorId));
  await paymentLog(orderViews.paymentRejectedEmbed(o, reason, actorId));
  await staffLog(orderViews.staffActionEmbed('PAYMENT REJECTED', o, actorId, reason));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `Payment rejected for ${orderId}.` };
}

/** 🔄 Ask the customer for a new proof. */
async function requestProof(orderId, actorId = ACTOR, reason = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };

  orders.update(order.order_id, { payment_proof_url: null });
  orders.setStatus(
    order.order_id,
    'awaiting_payment',
    actorId,
    'Staff requested new proof (dashboard)'
  );
  const o = fresh(orderId);
  await tellTicket(o, orderViews.reproofCustomer(o, actorId));
  await notifyOwner(orderViews.reproofRequestedEmbed(o, actorId));
  await paymentLog(orderViews.reproofRequestedEmbed(o, actorId));
  await staffLog(orderViews.staffActionEmbed('NEW PROOF REQUESTED', o, actorId, reason));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `New proof requested for ${orderId}.` };
}

/** 📦 Mark delivered → COMPLETED (decrements stock, records the timestamp). */
async function deliver(orderId, actorId = ACTOR, options = {}) {
  const force = Boolean(options.force);
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.order_status === 'completed') {
    return { ok: false, error: 'This order is already completed.' };
  }
  if (order.payment_status !== 'verified' && !force) {
    return {
      ok: false,
      error: 'Payment is not verified yet — approve it first, or force delivery.',
    };
  }

  orders.setStatus(order.order_id, 'completed', actorId, 'Order delivered (dashboard)');
  orders.update(order.order_id, { completed_at: stamp() });
  if (order.product_id) products.decrementStock(order.product_id, order.quantity || 0);
  const o = fresh(orderId);
  await tellTicket(o, orderViews.orderCompletedCustomer(o));
  await notifyOwner(orderViews.orderCompletedLog(o, actorId));
  await orderLog(orderViews.orderCompletedLog(o, actorId));
  await staffLog(orderViews.staffActionEmbed('ORDER DELIVERED', o, actorId, 'via web dashboard'));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `Order ${orderId} marked as delivered.` };
}

/** 🔴 Cancel the order. */
async function cancel(orderId, actorId = ACTOR, reason = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };
  if (order.order_status === 'cancelled') {
    return { ok: false, error: 'Order is already cancelled.' };
  }

  orders.setStatus(order.order_id, 'cancelled', actorId, reason || 'Cancelled from dashboard');
  const o = fresh(orderId);
  await tellTicket(o, orderViews.orderCancelledEmbed(o, actorId));
  await notifyOwner(orderViews.orderCancelledEmbed(o, actorId));
  await orderLog(orderViews.orderCancelledEmbed(o, actorId));
  await staffLog(orderViews.staffActionEmbed('ORDER CANCELLED', o, actorId, reason));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `Order ${orderId} cancelled.` };
}

/** ⚫ Refund (terminal, keeps the payment record for the audit trail). */
async function refund(orderId, actorId = ACTOR, note = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };

  orders.update(order.order_id, { payment_status: 'refunded' });
  orders.setStatus(order.order_id, 'refunded', actorId, note || 'Refunded from dashboard');
  const o = fresh(orderId);
  await tellTicket(o, orderViews.orderCancelledEmbed(o, actorId));
  await notifyOwner(orderViews.orderCancelledEmbed(o, actorId));
  await paymentLog(orderViews.paymentRejectedEmbed(o, note, actorId));
  await staffLog(orderViews.staffActionEmbed('ORDER REFUNDED', o, actorId, note));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `Order ${orderId} marked as REFUNDED.` };
}

/** 🎯 Arbitrary status change with an audit note. */
async function setStatus(orderId, status, actorId = ACTOR, note = '') {
  if (!STATUSES.includes(status)) return { ok: false, error: `Unknown status "${status}".` };
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };

  orders.setStatus(order.order_id, status, actorId, note || 'Status changed from dashboard');
  if (status === 'completed' && !order.completed_at) {
    orders.update(order.order_id, { completed_at: stamp() });
  }
  const o = fresh(orderId);
  await staffLog(orderViews.staffActionEmbed(`STATUS → ${status.toUpperCase()}`, o, actorId, note));
  await refreshTicketPanel(o);
  return { ok: true, order: o, message: `Status of ${orderId} set to ${status.toUpperCase()}.` };
}

/** 📝 Private staff note (never visible to customers). */
async function addNote(orderId, actorId = ACTOR, actorTag = 'dashboard', text = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };
  const clean = String(text).trim().slice(0, 1000);
  if (!clean) return { ok: false, error: 'Note is empty.' };

  const entry = `[${stamp().slice(0, 16).replace('T', ' ')} • ${actorTag}] ${clean}`;
  const prev = order.staff_note ? `${order.staff_note}\n` : '';
  orders.update(order.order_id, { staff_note: (prev + entry).slice(0, 4000) });
  orders.addEvent(order.order_id, 'staff_note', actorId, clean.slice(0, 200));
  await staffLog(orderViews.staffActionEmbed('STAFF NOTE', order, actorId, clean));
  return { ok: true, order: fresh(orderId), message: 'Staff note saved (customers never see it).' };
}

/** 🔒 Close the ticket: cancel live orders, then delete the channel. */
async function closeTicket(orderId, actorId = ACTOR, reason = '') {
  const order = orders.getByOrderId(orderId);
  if (!order) return { ok: false, error: 'Order not found.' };

  if (!TERMINAL.includes(order.order_status)) {
    orders.setStatus(order.order_id, 'cancelled', actorId, reason || 'Ticket closed from dashboard');
  } else {
    orders.addEvent(order.order_id, 'ticket_closed', actorId, reason || null);
  }
  const o = fresh(orderId);
  await staffLog(orderViews.staffActionEmbed('TICKET CLOSED', o, actorId, reason));

  const client = getClient();
  let deleted = false;
  if (client && o.ticket_channel_id) {
    try {
      const channel = await client.channels.fetch(o.ticket_channel_id);
      await channel.delete(`X SHOP order ${o.order_id} closed via dashboard`);
      deleted = true;
    } catch {
      /* channel already gone */
    }
  }
  if (deleted) orders.update(o.order_id, { ticket_channel_id: null });
  return {
    ok: true,
    order: fresh(orderId),
    message: deleted
      ? `Ticket for ${orderId} closed and channel deleted.`
      : `Order ${orderId} closed (ticket channel was not reachable).`,
  };
}

module.exports = {
  STATUSES,
  TERMINAL,
  stamp,
  tellTicket,
  refreshTicketPanel,
  approve,
  reject,
  requestProof,
  deliver,
  cancel,
  refund,
  setStatus,
  addNote,
  closeTicket,
};

