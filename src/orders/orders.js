'use strict';

const { db } = require('../database/db');
const { generateOrderId } = require('../utils/ids');
const { ACTIVE_STATUSES } = require('../utils/embeds');

const ACTIVE_SQL = `('${ACTIVE_STATUSES.join("','")}')`;

const getByOrderId = (orderId) => db.prepare('SELECT * FROM orders WHERE order_id = ?').get(orderId);

const getByChannel = (channelId) =>
  db.prepare('SELECT * FROM orders WHERE ticket_channel_id = ? ORDER BY id DESC').get(channelId);

function createOrder(user, product) {
  const orderId = generateOrderId(db);
  db.prepare(
    `INSERT INTO orders (order_id, discord_user_id, username, product_id, product_name, unit_price)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(orderId, user.id, user.username ?? user.tag ?? '', product.id, product.name, product.price);
  return getByOrderId(orderId);
}

/** Dynamic, injection-safe field update (keys must be real column names). */
function update(orderId, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE orders SET ${sets}, updated_at = datetime('now') WHERE order_id = @__oid`).run({
    ...Object.fromEntries(keys.map((k) => [k, fields[k]])),
    __oid: orderId,
  });
}

function addEvent(orderId, event, actorId = null, note = null) {
  db.prepare('INSERT INTO order_events (order_id, event, actor_id, note) VALUES (?, ?, ?, ?)').run(
    orderId,
    event,
    actorId,
    note
  );
}

function eventsFor(orderId, limit = 10) {
  return db
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT ?')
    .all(orderId, limit);
}

/** True when a given lifecycle event was ever recorded for the order. */
function hasEvent(orderId, event) {
  return Boolean(
    db
      .prepare('SELECT 1 FROM order_events WHERE order_id = ? AND event = ? LIMIT 1')
      .get(orderId, event)
  );
}

/** Update status and record the change in the status history. */
function setStatus(orderId, status, actorId = null, note = null) {
  update(orderId, { order_status: status });
  addEvent(orderId, `status:${status}`, actorId, note);
}

const activeCount = (userId) =>
  db.prepare(
    `SELECT COUNT(*) c FROM orders WHERE discord_user_id = ? AND order_status IN ${ACTIVE_SQL}`
  ).get(userId).c;

const activeForProduct = (userId, productId) =>
  db.prepare(
    `SELECT * FROM orders WHERE discord_user_id = ? AND product_id = ? AND order_status IN ${ACTIVE_SQL}
     ORDER BY id DESC LIMIT 1`
  ).get(userId, productId);

/** A customer's orders, newest first, for /orders pagination. */
const forUser = (userId, limit = 5, offset = 0) =>
  db
    .prepare('SELECT * FROM orders WHERE discord_user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(userId, limit, offset);

const countForUser = (userId) =>
  db.prepare('SELECT COUNT(*) c FROM orders WHERE discord_user_id = ?').get(userId).c;

function stats() {
  return db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN order_status IN ${ACTIVE_SQL} THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN order_status = 'refunded' THEN 1 ELSE 0 END) AS refunded,
        IFNULL(SUM(CASE WHEN order_status = 'completed' THEN total_price ELSE 0 END), 0) AS revenue,
        SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN 1 ELSE 0 END) AS today_orders,
        IFNULL(SUM(CASE WHEN date(created_at) = date('now', 'localtime') AND order_status = 'completed'
          THEN total_price ELSE 0 END), 0) AS today_revenue
      FROM orders`
    )
    .get();
}

const topProducts = (limit = 5) =>
  db.prepare(
    `SELECT product_name, COUNT(*) c, IFNULL(SUM(total_price), 0) revenue
     FROM orders WHERE order_status = 'completed'
     GROUP BY product_name ORDER BY c DESC LIMIT ?`
  ).all(limit);

const topCustomers = (limit = 5) =>
  db.prepare(
    `SELECT discord_user_id, username, COUNT(*) c, IFNULL(SUM(total_price), 0) revenue
     FROM orders WHERE order_status = 'completed'
     GROUP BY discord_user_id ORDER BY c DESC LIMIT ?`
  ).all(limit);

/** Safe answers access (answers is stored as JSON text). */
function answersOf(order) {
  try {
    const a = JSON.parse(order.answers || '[]');
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

module.exports = {
  getByOrderId,
  getByChannel,
  createOrder,
  update,
  addEvent,
  eventsFor,
  hasEvent,
  setStatus,
  activeCount,
  activeForProduct,
  forUser,
  countForUser,
  stats,
  topProducts,
  topCustomers,
  answersOf,
};
