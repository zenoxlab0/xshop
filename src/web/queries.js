'use strict';

/**
 * Read-only queries used by the web dashboard.
 * All filters are parameterised — never string-concatenated.
 */

const { db } = require('../database/db');

const STATUSES = [
  'pending',
  'awaiting_payment',
  'payment_review',
  'processing',
  'completed',
  'cancelled',
  'refunded',
];

function statusCounts() {
  const rows = db.prepare('SELECT order_status s, COUNT(*) c FROM orders GROUP BY order_status').all();
  const out = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of rows) out[r.s] = r.c;
  out.all = STATUSES.reduce((n, s) => n + out[s], 0);
  return out;
}

function kpis() {
  const row = db
    .prepare(
      `SELECT
        COUNT(*) total,
        SUM(CASE WHEN order_status = 'completed' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN order_status IN ('pending','awaiting_payment','payment_review','processing')
            THEN 1 ELSE 0 END) open,
        IFNULL(SUM(CASE WHEN order_status = 'completed' THEN total_price ELSE 0 END), 0) revenue,
        IFNULL(SUM(CASE WHEN order_status = 'completed' AND date(completed_at) = date('now','localtime')
            THEN total_price ELSE 0 END), 0) revenue_today,
        SUM(CASE WHEN date(created_at) = date('now','localtime') THEN 1 ELSE 0 END) orders_today,
        SUM(CASE WHEN payment_status = 'verified' THEN 1 ELSE 0 END) paid,
        SUM(CASE WHEN payment_proof_url IS NOT NULL AND payment_status != 'verified'
            THEN 1 ELSE 0 END) awaiting_review
       FROM orders`
    )
    .get();
  const aov = row.completed ? row.revenue / row.completed : 0;
  return { ...row, aov };
}

/** Daily order count + revenue for the last `days` days (gaps filled with 0). */
function dailySeries(days = 14) {
  const rows = db
    .prepare(
      `SELECT date(created_at) d,
              COUNT(*) orders,
              IFNULL(SUM(CASE WHEN order_status = 'completed' THEN total_price ELSE 0 END), 0) revenue
       FROM orders
       WHERE date(created_at) >= date('now','localtime', ?)
       GROUP BY d`
    )
    .all(`-${Math.max(1, days - 1)} days`);
  const map = new Map(rows.map((r) => [r.d, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(
      dt.getDate()
    ).padStart(2, '0')}`;
    const hit = map.get(key);
    out.push({ day: key, orders: hit ? hit.orders : 0, revenue: hit ? hit.revenue : 0 });
  }
  return out;
}

/** Orders list with optional status/search filters and pagination. */
function listOrders(options = {}) {
  const where = [];
  const params = {};
  if (options.status && options.status !== 'all') {
    where.push('o.order_status = @status');
    params.status = options.status;
  }
  if (options.paymentStatus) {
    where.push('o.payment_status = @paymentStatus');
    params.paymentStatus = options.paymentStatus;
  }
  if (options.q) {
    where.push(
      '(o.order_id LIKE @q OR o.username LIKE @q OR o.product_name LIKE @q OR o.discord_user_id LIKE @q)'
    );
    params.q = `%${String(options.q).slice(0, 64)}%`;
  }
  if (options.user) {
    where.push('o.discord_user_id = @user');
    params.user = String(options.user);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(parseInt(options.limit, 10) || 25, 1), 200);
  const page = Math.max(parseInt(options.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) c FROM orders o ${clause}`).get(params).c;
  const rows = db
    .prepare(
      `SELECT o.* FROM orders o ${clause}
       ORDER BY (o.order_status IN ('completed','cancelled','refunded')) ASC, o.id DESC
       LIMIT ${limit} OFFSET ${offset}`
    )
    .all(params);
  return { rows, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

const eventsFor = (orderId, limit = 100) =>
  db
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC LIMIT ?')
    .all(orderId, limit);

/** Global activity feed (all order events, newest first). */
const activityFeed = (limit = 40) =>
  db
    .prepare(
      `SELECT e.*, o.username, o.product_name, o.total_price
       FROM order_events e LEFT JOIN orders o ON o.order_id = e.order_id
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(Math.min(Number(limit) || 40, 200));

const topProducts = (limit = 8) =>
  db
    .prepare(
      `SELECT product_name, COUNT(*) orders, IFNULL(SUM(total_price), 0) revenue
       FROM orders WHERE order_status = 'completed'
       GROUP BY product_name ORDER BY revenue DESC LIMIT ?`
    )
    .all(limit);

const topCustomers = (limit = 8) =>
  db
    .prepare(
      `SELECT discord_user_id, username, COUNT(*) orders, IFNULL(SUM(total_price), 0) revenue,
              MAX(created_at) last_order
       FROM orders WHERE order_status = 'completed'
       GROUP BY discord_user_id ORDER BY revenue DESC LIMIT ?`
    )
    .all(limit);

function customers(q = '', limit = 100) {
  const like = `%${String(q).slice(0, 64)}%`;
  const select = `SELECT o.discord_user_id, o.username, COUNT(*) orders,
      IFNULL(SUM(CASE WHEN o.order_status='completed' THEN o.total_price ELSE 0 END),0) spent,
      SUM(CASE WHEN o.order_status='completed' THEN 1 ELSE 0 END) completed,
      SUM(CASE WHEN o.order_status IN ('completed','cancelled','refunded') THEN 0 ELSE 1 END) open_orders,
      IFNULL(SUM(CASE WHEN o.payment_status='verified' THEN 1 ELSE 0 END),0) paid_orders,
      MAX(o.created_at) last_order,
      MAX(CASE WHEN b.discord_user_id IS NULL THEN 0 ELSE 1 END) blacklisted,
      MAX(IFNULL(b.reason, '')) blacklist_reason
    FROM orders o LEFT JOIN blacklist b ON b.discord_user_id = o.discord_user_id`;
  return q
    ? db
        .prepare(`${select} WHERE o.username LIKE ? OR o.discord_user_id LIKE ? GROUP BY o.discord_user_id
                   ORDER BY last_order DESC LIMIT ?`)
        .all(like, like, limit)
    : db
        .prepare(`${select} GROUP BY o.discord_user_id ORDER BY spent DESC LIMIT ?`)
        .all(limit);
}

/** Blacklisted users (with or without previous orders). */
const blacklistedUsers = () =>
  db.prepare('SELECT discord_user_id, username, reason, created_at FROM blacklist ORDER BY created_at DESC').all();

function setBlacklist(discordUserId, { blocked, username = null, reason = null }) {
  const id = String(discordUserId || '').trim();
  if (!/^\d{5,25}$/.test(id)) return false;
  if (!blocked) {
    db.prepare('DELETE FROM blacklist WHERE discord_user_id = ?').run(id);
    return true;
  }
  db.prepare(
    `INSERT INTO blacklist (discord_user_id, username, reason) VALUES (?, ?, ?)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       username = IFNULL(excluded.username, blacklist.username),
       reason   = excluded.reason`
  ).run(id, username, String(reason || '').slice(0, 300) || 'Blocked from the dashboard');
  return true;
}

const isBlacklisted = (discordUserId) =>
  Boolean(db.prepare('SELECT 1 FROM blacklist WHERE discord_user_id = ?').get(String(discordUserId || '')));

/** Payment-method usage breakdown. */
const methodBreakdown = () =>
  db
    .prepare(
      `SELECT IFNULL(payment_method,'—') method, COUNT(*) orders,
              IFNULL(SUM(total_price),0) revenue
       FROM orders GROUP BY method ORDER BY orders DESC`
    )
    .all();

const categoriesWithCounts = () =>
  db
    .prepare(
      `SELECT c.*, COUNT(p.id) products,
              COUNT(p.id) product_count,
              IFNULL(SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END), 0) active_products
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.position, c.id`
    )
    .all();

/** Error-log rows written by the bot (mirrors the error log channel). */
const errorRows = (limit = 30) =>
  db
    .prepare('SELECT * FROM error_log ORDER BY id DESC LIMIT ?')
    .all(Math.min(Number(limit) || 30, 200));

const allProducts = () =>
  db
    .prepare(
      `SELECT p.*, c.name category_name, c.emoji category_emoji,
              (SELECT COUNT(*) FROM orders o WHERE o.product_id = p.id) orders
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       ORDER BY c.position, c.id, p.id`
    )
    .all();

const allSettings = () => db.prepare('SELECT key, value FROM settings ORDER BY key').all();

const ordersForUser = (userId, limit = 20) =>
  db
    .prepare('SELECT * FROM orders WHERE discord_user_id = ? ORDER BY id DESC LIMIT ?')
    .all(String(userId), limit);

module.exports = {
  STATUSES,
  statusCounts,
  kpis,
  dailySeries,
  listOrders,
  eventsFor,
  activityFeed,
  errorRows,
  topProducts,
  topCustomers,
  customers,
  blacklistedUsers,
  setBlacklist,
  isBlacklisted,
  methodBreakdown,
  categoriesWithCounts,
  allProducts,
  allSettings,
  ordersForUser,
};

