'use strict';

/**
 * X SHOP — premium web dashboard.
 *
 * Zero-extra-dependency Express app: server-rendered HTML, cookie sessions with
 * CSRF protection, login rate limiting and audit logging. Every action that
 * touches an order reuses the same domain services as the Discord bot
 * (`src/orders/actions.js`), so the two worlds can never drift apart.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../config/config');
const { db, getSetting, setSetting, deleteSetting } = require('../database/db');
const { errorLog } = require('../services/logs');
const orderActions = require('../orders/actions');
const orders = require('../orders/orders');
const methods = require('../payments/methods');
const products = require('../products/products');
const {
  emojiReport,
  EMOJI_KEYS,
  setEmojiValue,
  setEmojiClient,
  guildEmojiList,
} = require('../utils/embeds');
const queries = require('./queries');
const views = require('./views');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const COOKIE = 'xsid';

const sessions = new Map(); // sid -> { csrf, authed, created, seen }
const loginHits = new Map(); // ip -> { count, until }
let discordClient = null;

// ── Small helpers ───────────────────────────────────────────────────────────

const timingSafe = (a, b) => {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function newSession() {
  const sid = crypto.randomBytes(24).toString('hex');
  const session = {
    csrf: crypto.randomBytes(24).toString('hex'),
    authed: false,
    created: Date.now(),
    seen: Date.now(),
  };
  sessions.set(sid, session);
  return { sid, session };
}

function pruneSessions() {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (now - s.seen > SESSION_TTL_MS) sessions.delete(sid);
  }
  for (const [ip, hit] of loginHits) {
    if (hit.until && hit.until < now && hit.count >= MAX_LOGIN_FAILURES) loginHits.delete(ip);
  }
}

function redirectWith(res, url, message, type = 'ok') {
  const sep = url.includes('?') ? '&' : '?';
  const qs = new URLSearchParams({ msg: message });
  if (type === 'err') qs.set('t', 'err');
  res.redirect(303, `${url}${sep}${qs.toString()}`);
}

const flashFrom = (req) =>
  req.query.msg ? { message: String(req.query.msg).slice(0, 300), type: req.query.t === 'err' ? 'err' : 'ok' } : null;

// ── Payment-method presentation ─────────────────────────────────────────────

/** Known editable fields per method key; custom methods declare fields via `_fields`. */
const PAYMENT_FIELD_SCHEMAS = {
  upi: { upi_id: { label: 'UPI ID' }, name: { label: 'Payee name' } },
  upi2: { upi_id: { label: 'UPI ID' }, name: { label: 'Payee name' } },
  bitcoin: { wallet: { label: 'BTC wallet address' }, coin: { label: 'Coin' }, network: { label: 'Network' } },
  crypto: { wallet: { label: 'Wallet address' }, coin: { label: 'Coin' }, network: { label: 'Network' } },
};

/** Shape a payment_methods row for the payments page (schema, values, badges). */
function paymentForView(method) {
  const cfg = methods.cfg(method);
  const declared = Array.isArray(cfg._fields) ? cfg._fields : [];
  const schema = {
    ...(PAYMENT_FIELD_SCHEMAS[method.key] || {}),
    ...Object.fromEntries(declared.map((f) => [f, { label: f }])),
  };
  const values = Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== '_fields'));
  const configured = Object.entries(values).some(
    ([k, v]) => k !== 'qr_url' && v !== undefined && v !== null && String(v).trim() !== ''
  );
  const qrFile = path.join(config.qrDir, `${method.key}.png`);
  return {
    ...method,
    fields: JSON.stringify(schema),
    values,
    configured,
    qr_url: values.qr_url || (fs.existsSync(qrFile) ? `/qr/${method.key}.png` : ''),
  };
}

// ── Middleware ──────────────────────────────────────────────────────────────

function attachSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let sid = cookies[COOKIE];
  let session = sid ? sessions.get(sid) : null;
  if (!session) {
    if (sid) res.clearCookie(COOKIE, { path: '/' });
    const made = newSession();
    sid = made.sid;
    session = made.session;
    res.cookie(COOKIE, sid, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
    });
  }
  session.seen = Date.now();
  req.sid = sid;
  req.session = session;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.authed) return res.redirect(303, '/login');
  next();
}

function requireCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const sent = req.body?._csrf || req.get('x-csrf-token') || '';
  if (!timingSafe(sent, req.session.csrf)) {
    return res.status(403).send('CSRF token invalid or expired — reload the dashboard and try again.');
  }
  next();
}

// ── Pages ───────────────────────────────────────────────────────────────────

function page(res, built, req, extra = {}) {
  res.type('html').send(
    views.layout({
      ...built,
      csrf: req.session.csrf,
      flash: views.flashBox(flashFrom(req)),
      ...extra,
    })
  );
}

function startDashboard(client) {
  discordClient = client || null;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(express.json({ limit: '256kb' }));
  app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
  app.use('/qr', express.static(config.qrDir, { maxAge: '5m' }));
  app.use(attachSession);
  app.use(requireCsrf);

  // ── Health + auth ─────────────────────────────────────────────────────────

  app.get('/healthz', (req, res) =>
    res.json({
      ok: true,
      bot: discordClient && discordClient.isReady() ? 'online' : 'offline',
      guilds: discordClient ? discordClient.guilds.cache.size : 0,
      uptime: Math.round(process.uptime()),
      orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    })
  );

  app.get('/login', (req, res) => {
    if (req.session.authed) return res.redirect(303, '/');
    if (!config.web.password) {
      return res
        .type('html')
        .send(
          views.loginPage({
            error: 'No WEB_DASHBOARD_PASSWORD is set in .env — the dashboard is locked.',
            csrf: req.session.csrf,
          })
        );
    }
    res.type('html').send(
      views.loginPage({
        error: req.query.err ? String(req.query.err).slice(0, 160) : null,
        csrf: req.session.csrf,
      })
    );
  });

  app.post('/login', (req, res) => {
    const ip = req.ip || 'local';
    const hit = loginHits.get(ip);
    const locked = hit && hit.until && hit.until > Date.now();

    if (locked) {
      const mins = Math.ceil((hit.until - Date.now()) / 60000);
      return redirectWith(res, '/login', `Too many failed attempts — locked for ~${mins} minute(s).`, 'err');
    }

    const pass = String(req.body?.password || '');
    if (!timingSafe(pass, config.web.password)) {
      const count = (locked ? hit.count : hit?.count || 0) + 1;
      loginHits.set(ip, {
        count,
        until: count >= MAX_LOGIN_FAILURES ? Date.now() + LOGIN_LOCK_MS : 0,
      });
      errorLog('web login', new Error(`Failed dashboard login from ${ip} (${count}/${MAX_LOGIN_FAILURES})`));
      return redirectWith(res, '/login', `Wrong password — attempt ${count} of ${MAX_LOGIN_FAILURES}.`, 'err');
    }

    loginHits.delete(ip);
    req.session.authed = true; // same sid → the CSRF token stays valid
    redirectWith(res, '/', 'Welcome back ✦ live order control unlocked.');
  });

  app.get('/logout', (req, res) => {
    req.session.authed = false;
    redirectWith(res, '/login', 'Signed out.');
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  app.get('/', requireAuth, (req, res) => {
    page(res, views.dashboardPage({
      csrf: req.session.csrf,
      k: queries.kpis(),
      series: queries.dailySeries(14),
      counts: queries.statusCounts(),
      recent: queries.listOrders({ limit: 8 }).rows,
      topP: queries.topProducts(6),
      topC: queries.topCustomers(5),
      methods: queries.methodBreakdown(),
    }), req);
  });

  // ── Orders ────────────────────────────────────────────────────────────────

  app.get('/orders', requireAuth, (req, res) => {
    const filters = {
      status: String(req.query.status || 'all'),
      payment: String(req.query.payment || ''),
      q: String(req.query.q || '').slice(0, 64),
      page: parseInt(req.query.page, 10) || 1,
      limit: [25, 50, 100].includes(parseInt(req.query.limit, 10)) ? parseInt(req.query.limit, 10) : 25,
    };
    const result = queries.listOrders(filters);
    page(res, views.ordersPage({ result, filters, counts: queries.statusCounts(), csrf: req.session.csrf }), req);
  });

  app.get('/orders/:id', requireAuth, (req, res) => {
    const orderId = String(req.params.id);
    const order = orders.getByOrderId(orderId);
    if (!order) return redirectWith(res, '/orders', `Order ${orderId} was not found.`, 'err');
    page(res, views.orderPage({
      order,
      events: queries.eventsFor(orderId, 60),
      clientReady: Boolean(discordClient && discordClient.isReady()),
      csrf: req.session.csrf,
    }), req);
  });

  // ── Order actions (shared with the Discord staff panel) ───────────────────

  app.post('/api/orders/:id/action', requireAuth, async (req, res) => {
    const orderId = String(req.params.id);
    const action = String(req.body?.action || '');
    const reason = String(req.body?.reason || '').slice(0, 500);
    const note = String(req.body?.note || '').slice(0, 1000);
    const actor = `web:${req.ip || 'local'}`;
    const back = `/orders/${encodeURIComponent(orderId)}`;

    try {
      let out;
      switch (action) {
        case 'approve':
          out = await orderActions.approve(orderId, actor);
          break;
        case 'reject':
          out = await orderActions.reject(orderId, actor, reason);
          break;
        case 'reproof':
          out = await orderActions.requestProof(orderId, actor, reason);
          break;
        case 'deliver':
          out = await orderActions.deliver(orderId, actor, { force: req.body?.force === '1' });
          break;
        case 'cancel':
          out = await orderActions.cancel(orderId, actor, reason);
          break;
        case 'refund':
          out = await orderActions.refund(orderId, actor, note);
          break;
        case 'status':
          out = await orderActions.setStatus(orderId, String(req.body?.status || ''), actor, note);
          break;
        case 'note':
          out = await orderActions.addNote(orderId, actor, `dashboard (${req.ip || 'local'})`, note);
          break;
        case 'close':
          out = await orderActions.closeTicket(orderId, actor, reason);
          break;
        default:
          out = { ok: false, error: `Unknown action "${action}".` };
      }

      const slug = action === 'close' ? '/orders' : back;
      if (req.get('x-requested-with') === 'fetch' || req.is('application/json')) {
        return res.status(out.ok ? 200 : 400).json(out);
      }
      return redirectWith(res, out.ok ? slug : back, out.ok ? out.message : out.error, out.ok ? 'ok' : 'err');
    } catch (err) {
      await errorLog(`dashboard action ${action} on ${orderId}`, err);
      if (req.get('x-requested-with') === 'fetch') {
        return res.status(500).json({ ok: false, error: err.message });
      }
      return redirectWith(res, back, `Action failed: ${err.message}`, 'err');
    }
  });

  // ── Catalog: categories + products (stock, price, status) ─────────────────

  app.get('/catalog', requireAuth, (req, res) => {
    const filter = String(req.query.category || '');
    const categories = queries.categoriesWithCounts();
    const all = queries.allProducts();
    const products = filter ? all.filter((p) => String(p.category_id) === filter) : all;
    page(res, views.catalogPage({ categories, products, filter, csrf: req.session.csrf }), req);
  });

  app.post('/api/products', requireAuth, (req, res) => {
    const b = req.body || {};
    try {
      const product = products.createProduct({
        category_id: b.category_id,
        name: b.name,
        emoji: b.emoji,
        description: b.description,
        price: b.price,
        stock: b.stock,
        minimum_quantity: b.minimum_quantity,
        maximum_quantity: b.maximum_quantity,
        status: b.status,
        image_url: b.image_url,
      });
      redirectWith(res, `/catalog?category=${product.category_id}`, `Product "${product.name}" created.`);
    } catch (err) {
      redirectWith(res, '/catalog', `Could not create product: ${err.message}`, 'err');
    }
  });

  app.post('/api/products/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const op = String(req.body?.op || 'update');
    if (!products.getProduct(id)) return redirectWith(res, '/catalog', 'Product not found.', 'err');
    try {
      if (op === 'delete') {
        products.deleteProduct(id);
        return redirectWith(res, '/catalog', 'Product deleted.');
      }
      const b = req.body || {};
      const fields = {};
      for (const key of [
        'name', 'emoji', 'description', 'price', 'stock', 'minimum_quantity',
        'maximum_quantity', 'status', 'image_url', 'category_id',
      ]) {
        if (b[key] !== undefined && String(b[key]).trim() !== '') fields[key] = b[key];
      }
      // Empty image box clears the banner.
      if (b.image_url === '') fields.image_url = '';
      products.updateProduct(id, fields);
      redirectWith(res, '/catalog', 'Product updated.');
    } catch (err) {
      redirectWith(res, '/catalog', `Could not update product: ${err.message}`, 'err');
    }
  });

  app.post('/api/categories', requireAuth, (req, res) => {
    const b = req.body || {};
    try {
      const category = products.createCategory({
        name: b.name,
        emoji: b.emoji,
        description: b.description,
        position: b.position,
        status: b.status,
      });
      redirectWith(res, '/catalog', `Category "${category.name}" created.`);
    } catch (err) {
      redirectWith(res, '/catalog', `Could not create category: ${err.message}`, 'err');
    }
  });

  app.post('/api/categories/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const op = String(req.body?.op || 'update');
    if (!products.getCategory(id)) return redirectWith(res, '/catalog', 'Category not found.', 'err');
    try {
      if (op === 'delete') {
        products.deleteCategory(id); // products cascade (ON DELETE CASCADE)
        return redirectWith(res, '/catalog', 'Category and its products deleted.');
      }
      const b = req.body || {};
      const fields = {};
      for (const key of ['name', 'emoji', 'description', 'position', 'status']) {
        if (b[key] !== undefined && String(b[key]).trim() !== '') fields[key] = b[key];
      }
      products.updateCategory(id, fields);
      redirectWith(res, '/catalog', 'Category updated.');
    } catch (err) {
      redirectWith(res, '/catalog', `Could not update category: ${err.message}`, 'err');
    }
  });

  // ── Payment methods ───────────────────────────────────────────────────────

  app.get('/payments', requireAuth, (req, res) => {
    page(res, views.paymentsPage({ methods: methods.listAll().map(paymentForView), csrf: req.session.csrf }), req);
  });

  app.post('/api/payments', requireAuth, (req, res) => {
    const b = req.body || {};
    const key = String(b.key || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{2,32}$/.test(key)) {
      return redirectWith(res, '/payments', 'Method key must be 2–32 chars: a-z, 0-9, underscore.', 'err');
    }
    try {
      methods.upsert(key, String(b.label || key).slice(0, 100), String(b.emoji || '💳').slice(0, 64));
      const fields = String(b.fields || '')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);
      methods.setFields(key, { ...(fields.length ? { _fields: fields } : {}), ...(b.qr_url ? { qr_url: b.qr_url } : {}) });
      if (b.instructions) db.prepare('UPDATE payment_methods SET instructions = ? WHERE key = ?').run(String(b.instructions).slice(0, 1000), key);
      redirectWith(res, '/payments', `Payment method "${key}" created.`);
    } catch (err) {
      redirectWith(res, '/payments', `Could not create method: ${err.message}`, 'err');
    }
  });

  app.post('/api/payments/:key', requireAuth, (req, res) => {
    const key = String(req.params.key);
    const method = methods.get(key);
    if (!method) return redirectWith(res, '/payments', 'Payment method not found.', 'err');
    const op = String(req.body?.op || 'save');
    try {
      if (op === 'toggle') {
        const enable = String(req.body?.active) === '1';
        methods.setStatus(key, enable ? 'active' : 'hidden');
        return redirectWith(res, '/payments', `"${method.label}" ${enable ? 'enabled' : 'disabled'}.`);
      }
      if (op === 'delete') {
        methods.remove(key);
        return redirectWith(res, '/payments', `"${method.label}" deleted.`);
      }
      // save: label/emoji/instructions/qr + every field_<name> input
      const b = req.body || {};
      methods.upsert(key, String(b.label || method.label).slice(0, 100), String(b.emoji || method.emoji).slice(0, 64));
      db.prepare('UPDATE payment_methods SET instructions = ? WHERE key = ?').run(
        String(b.instructions || '').slice(0, 1000),
        key
      );
      const updates = { qr_url: String(b.qr_url || '') };
      for (const [name, value] of Object.entries(b)) {
        if (name.startsWith('field_')) updates[name.slice('field_'.length)] = String(value).slice(0, 300);
      }
      methods.setFields(key, updates);
      redirectWith(res, '/payments', `"${method.label}" saved.`);
    } catch (err) {
      redirectWith(res, '/payments', `Could not save method: ${err.message}`, 'err');
    }
  });

  // ── Customers: purchase history + blacklist ───────────────────────────────

  app.get('/customers', requireAuth, (req, res) => {
    page(res, views.customersPage({ customers: queries.customers(String(req.query.q || '').slice(0, 64)), csrf: req.session.csrf }), req);
  });

  app.get('/customers/:id', requireAuth, (req, res) => {
    const id = String(req.params.id);
    const customer = queries.customers(id).find((c) => c.discord_user_id === id);
    if (!customer) return redirectWith(res, '/customers', 'Customer not found.', 'err');
    page(res, views.customerPage({
      customer,
      orders: queries.ordersForUser(id, 100),
      clientReady: Boolean(discordClient && discordClient.isReady()),
      csrf: req.session.csrf,
    }), req);
  });

  app.post('/api/customers/blacklist', requireAuth, (req, res) => {
    const b = req.body || {};
    const ok = queries.setBlacklist(b.discord_user_id, {
      blocked: String(b.op) !== 'remove',
      username: null,
      reason: b.reason,
    });
    redirectWith(res, '/customers', ok ? 'Customer blacklist updated.' : 'Invalid Discord user ID.', ok ? 'ok' : 'err');
  });

  // ── Emoji studio ──────────────────────────────────────────────────────────

  app.get('/emojis', requireAuth, (req, res) => {
    page(res, views.emojisPage({
      report: emojiReport(),
      guildEmojis: guildEmojiList(discordClient),
      keys: EMOJI_KEYS,
      csrf: req.session.csrf,
    }), req);
  });

  app.post('/api/emojis', requireAuth, (req, res) => {
    const result = setEmojiValue(String(req.body?.key || ''), req.body?.value ?? '');
    redirectWith(res, '/emojis', result.ok ? `Emoji "${req.body?.key}" saved — live everywhere instantly.` : result.error, result.ok ? 'ok' : 'err');
  });

  app.post('/api/emojis/reset', requireAuth, (req, res) => {
    const key = String(req.body?.key || '');
    const result = setEmojiValue(key, '');
    redirectWith(res, '/emojis', result.ok ? `Emoji "${key}" reset to fallback.` : result.error, result.ok ? 'ok' : 'err');
  });

  app.post('/api/emojis/rescan', requireAuth, (req, res) => {
    const matched = setEmojiClient(discordClient);
    redirectWith(res, '/emojis', `Re-scanned server emojis — ${matched} key(s) auto-matched.`);
  });

  // ── Activity + settings ───────────────────────────────────────────────────

  app.get('/activity', requireAuth, (req, res) => {
    page(res, views.activityPage({ feed: queries.activityFeed(60), errors: queries.errorRows(30), csrf: req.session.csrf }), req);
  });

  app.get('/settings', requireAuth, (req, res) => {
    const envKeys = [
      'GUILD_ID', 'SHOP_CHANNEL_ID', 'STAFF_ROLE_ID', 'ADMIN_ROLE_ID', 'ORDER_CATEGORY_ID',
      'ORDER_LOG_CHANNEL_ID', 'PAYMENT_LOG_CHANNEL_ID', 'STAFF_LOG_CHANNEL_ID', 'ERROR_LOG_CHANNEL_ID',
      'PREFIX', 'BUY_TRIGGERS', 'CURRENCY', 'WEB_PORT', 'OWNER_ID', 'OWNER_IDS', 'BOT_ACTIVITY_TYPE', 'BOT_ACTIVITY_TEXT', 'BOT_ACTIVITY_EMOJI', 'BOT_ACTIVITY_URL', 'BOT_STATUS', 'ORDER_REVIEW_TARGET', 'ORDER_REVIEW_CHANNEL_ID',
    ];
    const env = Object.fromEntries(envKeys.map((k) => [k, process.env[k] || '']));
    const clientReady = Boolean(discordClient && discordClient.isReady());
    page(res, views.settingsPage({
      env,
      settings: queries.allSettings(),
      keys: queries.allSettings(),
      maintenance: getSetting('maintenance') === '1',
      botInfo: {
        tag: discordClient?.user?.tag || '',
        status: clientReady ? 'online' : discordClient ? 'connecting…' : 'not connected',
        guilds: discordClient ? discordClient.guilds.cache.size : 0,
      },
      csrf: req.session.csrf,
    }), req);
  });

  app.post('/api/settings', requireAuth, (req, res) => {
    const b = req.body || {};
    const key = String(b.key || '').trim();
    if (!/^[a-zA-Z0-9_:-]{1,64}$/.test(key)) {
      return redirectWith(res, '/settings', 'Invalid setting key.', 'err');
    }
    if (String(b.op) === 'delete') {
      deleteSetting(key);
      return redirectWith(res, '/settings', `Setting "${key}" deleted.`);
    }
    setSetting(key, String(b.value ?? ''));
    redirectWith(res, '/settings', `Setting "${key}" saved.`);
  });

  // ── Purchase-history export ───────────────────────────────────────────────

  app.get('/orders.csv', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 5000').all();
    const cols = [
      'order_id', 'discord_user_id', 'username', 'product_name', 'quantity', 'unit_price',
      'total_price', 'payment_method', 'payment_status', 'order_status', 'verified_by',
      'created_at', 'completed_at',
    ];
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
    res.type('text/csv').set(
      'Content-Disposition',
      `attachment; filename="xshop-orders-${new Date().toISOString().slice(0, 10)}.csv"`
    );
    res.send(csv);
  });

  // __ROUTES3__


  app.listen(config.web.port, config.web.host, () => {
    console.log(
      `✦ Dashboard listening on http://localhost:${config.web.port}` +
        (config.web.password ? '' : ' — LOCKED (set WEB_DASHBOARD_PASSWORD in .env)')
    );
  });
  return app;
}
// __TAIL__

module.exports = { startDashboard };
