/**
 * X SHOP web dashboard end-to-end check — boots the real Express app on an
 * isolated DATA_DIR (no Discord client) and drives every GET page and every
 * mutating POST route, asserting both the HTTP outcome and the database
 * effect, so a dashboard change that never reaches the bot fails here.
 *
 * Run: npm run web-e2e
 */

const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failures++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

(async () => {
  // Free port first, before config.js reads WEB_PORT.
  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });

  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'xshop-web-e2e-'));
  process.env.DISCORD_TOKEN = 'web-e2e-token';
  process.env.CLIENT_ID = '123456789012345678';
  process.env.OWNER_ID = '123456789012345678';
  process.env.GUILD_ID = '123456789012345678';
  process.env.SHOP_CHANNEL_ID = '123456789012345678';
  process.env.STAFF_ROLE_ID = '123456789012345678';
  process.env.ORDER_CATEGORY_ID = '123456789012345678';
  process.env.WEB_DASHBOARD_PASSWORD = 'e2e-pass-123';
  process.env.WEB_PORT = String(port);

  const { db, getSetting } = require('../src/database/db');
  const products = require('../src/products/products');
  const methods = require('../src/payments/methods');
  const orders = require('../src/orders/orders');
  const { e } = require('../src/utils/embeds');
  const { isBlacklisted } = require('../src/web/queries');
  const { startDashboard } = require('../src/web/server');

  // ── Tiny cookie-jar HTTP client ────────────────────────────────────────────
  const jar = {};
  const call = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      redirect: 'manual',
      headers: {
        cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    for (const c of String(res.headers.get('set-cookie') || '').split(';')) {
      const eq = c.indexOf('=');
      if (eq > -1 && c.slice(0, eq).trim() === 'xsid') {
        jar.xsid = decodeURIComponent(c.slice(eq + 1).split(';')[0].trim());
      }
    }
    const location = res.headers.get('location') || '';
    const flash = new URLSearchParams(location.split('?')[1] || '');
    return { status: res.status, location, msg: flash.get('msg'), err: flash.get('t') === 'err', text: await res.text() };
  };

  // ── Boot + seed ────────────────────────────────────────────────────────────
  startDashboard(null);
  for (let i = 0; i < 50; i++) {
    try { await fetch(`http://127.0.0.1:${port}/healthz`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const cat = products.createCategory({ name: 'E2E Cat', emoji: '🧪', position: 99 });
  const prod = products.createProduct({
    category_id: cat.id, name: 'E2E Product', emoji: '⚗️', price: 4.2, stock: 7, status: 'active',
  });
  const user = { id: '987654321098765432', username: 'e2e-tester' };
  const order = orders.createOrder(user, prod);
  methods.upsert('e2e_method', 'E2E Method', '💠');

  console.log('Auth & guards:');
  {
    let r = await call('GET', '/healthz');
    ok('GET /healthz (no auth)', r.status === 200 && JSON.parse(r.text).ok === true);

    r = await call('GET', '/');
    ok('GET / redirects to /login when signed out', r.status === 303 && r.location.startsWith('/login'));

    r = await call('GET', '/login');
    const csrf = (r.text.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
    ok('GET /login renders with CSRF token', r.status === 200 && Boolean(csrf));

    r = await call('POST', '/api/settings', { key: 'x', value: '1', _csrf: 'wrong' });
    ok('POST without CSRF token is rejected 403', r.status === 403);

    r = await call('POST', '/login', { password: 'nope', _csrf: csrf });
    ok('wrong password rejected', r.err === true && /Wrong password/.test(r.msg || ''));

    r = await call('POST', '/login', { password: 'e2e-pass-123', _csrf: csrf });
    ok('correct password signs in', r.status === 303 && r.location.startsWith('/') && r.err !== true, r.location);

    r = await call('GET', '/login');
    ok('signed-in /login bounces to dashboard', r.status === 303 && r.location === '/');
  }

  const settingsRes = await call('GET', '/settings');
  const pageCsrf = (settingsRes.text.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];
  if (!pageCsrf) {
    console.error(`Cannot extract CSRF from /settings (status ${settingsRes.status}, loc ${settingsRes.location}):`);
    console.error(settingsRes.text.slice(0, 500));
    process.exit(1);
  }
  const post = (url, body) => call('POST', url, { _csrf: pageCsrf, ...body });

  console.log('Pages render:');
  for (const [name, url] of [
    ['dashboard', '/'], ['orders', '/orders'], ['order detail', `/orders/${order.order_id}`],
    ['catalog', '/catalog'], ['payments', '/payments'], ['customers', '/customers'],
    ['customer detail', `/customers/${user.id}`], ['emoji studio', '/emojis'],
    ['activity', '/activity'], ['settings', '/settings'], ['orders.csv', '/orders.csv'],
  ]) {
    const r = await call('GET', url);
    ok(`GET ${url} (${name})`, r.status === 200 && !/Error:/.test(r.text.slice(0, 400)), `status ${r.status}`);
  }

  console.log('Settings apply live:');
  {
    let r = await post('/api/settings', { key: 'maintenance', value: '1' });
    ok('maintenance ON saved', r.err !== true, r.msg);
    ok('bot-side reads maintenance=1', getSetting('maintenance') === '1');

    r = await post('/api/settings', { key: 'maintenance', value: '0' });
    ok('maintenance OFF saved', getSetting('maintenance') === '0', r.msg);

    r = await post('/api/settings', { key: 'e2e_custom', value: 'hello' });
    ok('custom setting saved', getSetting('e2e_custom') === 'hello', r.msg);

    r = await post('/api/settings', { key: 'e2e_custom', op: 'delete' });
    ok('setting deleted', getSetting('e2e_custom') === null, r.msg);
  }

  console.log('Emoji studio applies live:');
  {
    let r = await post('/api/emojis', { key: 'shop', value: '<:e2e_shop:424242424242424242>' });
    ok('emoji override saved', r.err !== true, r.msg);
    ok('e("shop") returns the override', e('shop') === '<:e2e_shop:424242424242424242>');

    r = await post('/api/emojis/reset', { key: 'shop' });
    ok('emoji override reset', r.err !== true, r.msg);
    ok('e("shop") back to curated default', e('shop') !== '<:e2e_shop:424242424242424242>');

    r = await post('/api/emojis/rescan', {});
    ok('rescan survives a disconnected client', r.status === 303 && r.err !== true, r.msg);
  }

  console.log('Catalog applies:');
  {
    let r = await post('/api/categories', { name: 'E2E Cat 2', emoji: '🧫', status: 'active' });
    const row2 = db.prepare("SELECT * FROM categories WHERE name = 'E2E Cat 2'").get();
    ok('category created', r.err !== true && Boolean(row2), r.msg);

    r = await post(`/api/categories/${row2.id}`, { name: 'E2E Cat 2b' });
    ok('category renamed', db.prepare('SELECT name FROM categories WHERE id = ?').get(row2.id).name === 'E2E Cat 2b', r.msg);

    r = await post(`/api/categories/${row2.id}`, { op: 'delete' });
    ok('category deleted', !db.prepare('SELECT 1 FROM categories WHERE id = ?').get(row2.id), r.msg);

    r = await post('/api/products', { category_id: String(cat.id), name: 'E2E P2', price: '1.5', stock: '3', status: 'active' });
    const p2 = db.prepare("SELECT * FROM products WHERE name = 'E2E P2'").get();
    ok('product created', r.err !== true && Boolean(p2), r.msg);

    r = await post(`/api/products/${p2.id}`, { price: '9.99', stock: '42' });
    const after = db.prepare('SELECT price, stock FROM products WHERE id = ?').get(p2.id);
    ok('product price/stock updated', Number(after.price) === 9.99 && after.stock === 42, JSON.stringify(after));

    r = await post(`/api/products/${p2.id}`, { op: 'delete' });
    ok('product deleted', !db.prepare('SELECT 1 FROM products WHERE id = ?').get(p2.id), r.msg);
  }

  console.log('Payment methods apply:');
  {
    let r = await post('/api/payments/e2e_method', { op: 'save', label: 'E2E Method', emoji: '💠', field_upi_id: 'e2e@upi', instructions: 'pay here' });
    const m = methods.get('e2e_method');
    const cfg = methods.cfg(m);
    ok('method fields saved', r.err !== true && cfg.upi_id === 'e2e@upi' && m.instructions === 'pay here', JSON.stringify(cfg));

    r = await post('/api/payments/e2e_method', { op: 'toggle', active: '0' });
    ok('method disabled', methods.get('e2e_method').status === 'hidden', r.msg);

    r = await post('/api/payments/e2e_method', { op: 'toggle', active: '1' });
    ok('method enabled', methods.get('e2e_method').status === 'active', r.msg);

    r = await post('/api/payments', { key: 'e2e_new', label: 'E2E New', emoji: '🪙' });
    ok('method created', Boolean(methods.get('e2e_new')), r.msg);

    r = await post('/api/payments/e2e_new', { op: 'delete' });
    ok('method deleted', !methods.get('e2e_new'), r.msg);
  }

  console.log('Blacklist applies:');
  {
    let r = await post('/api/customers/blacklist', { discord_user_id: user.id, op: 'add', reason: 'e2e block' });
    const blocked = db.prepare('SELECT * FROM blacklist WHERE discord_user_id = ?').get(user.id);
    ok('customer blocked in DB', r.err !== true && Boolean(blocked), r.msg);
    ok('bot-side buy gate sees the block', isBlacklisted(user.id) === true);

    r = await post('/api/customers/blacklist', { discord_user_id: user.id, op: 'remove' });
    ok('customer unblocked', !db.prepare('SELECT 1 FROM blacklist WHERE discord_user_id = ?').get(user.id), r.msg);
    ok('bot-side buy gate sees the lift', isBlacklisted(user.id) === false);
  }

  console.log('Order actions apply:');
  {
    let r = await post(`/api/orders/${order.order_id}/action`, { action: 'status', status: 'processing', note: 'e2e' });
    ok('status change applies', orders.getByOrderId(order.order_id).order_status === 'processing', r.err ? r.msg : '');

    r = await post(`/api/orders/${order.order_id}/action`, { action: 'note', note: 'hello from e2e' });
    const events = db.prepare("SELECT * FROM order_events WHERE order_id = ? AND event = 'staff_note'").all(order.order_id);
    ok('note lands in the order log', r.err !== true && events.some((ev) => /hello from e2e/.test(ev.note || '')), r.msg);

    r = await post(`/api/orders/${order.order_id}/action`, { action: 'nonsense' });
    ok('unknown action rejected', r.err === true, r.msg);
  }

  console.log(failures === 0 ? '\n✦ WEB E2E: ALL CHECKS PASSED' : `\n✦ WEB E2E: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('web-e2e crashed:', err);
  process.exit(1);
});
