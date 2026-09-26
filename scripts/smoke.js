/**
 * X SHOP smoke test — verifies the database layer, seed data, view builders
 * and order state machine without connecting to Discord.
 *
 * Run: npm run smoke
 */

// Dummy env so config.js doesn't exit, and an isolated DATA_DIR so the
// smoke test never touches the live database.
process.env.DATA_DIR = require('fs').mkdtempSync(
  require('path').join(require('os').tmpdir(), 'xshop-smoke-')
);
process.env.DISCORD_TOKEN = 'smoke-test-token';
process.env.CLIENT_ID = '123456789012345678';
process.env.OWNER_ID = '123456789012345678';
// Multiple owners: OWNER_IDS is merged with OWNER_ID, duplicates are removed
// and non-snowflake entries are ignored (the duplicate + bad id below are
// deliberate, so the parsing/validation path is exercised).
process.env.OWNER_IDS = '111111111111111111, 222222222222222222, 123456789012345678, not-an-id';
// Presence: pinned here so the checks never depend on the developer's .env.
process.env.BOT_ACTIVITY_TYPE = 'WATCHING';
process.env.BOT_ACTIVITY_TEXT = 'X SHOP • type "buy"';
process.env.BOT_ACTIVITY_EMOJI = 'on';
process.env.BOT_ACTIVITY_URL = '';
process.env.BOT_STATUS = 'online';
process.env.GUILD_ID = '123456789012345678';
process.env.SHOP_CHANNEL_ID = '123456789012345678';
process.env.STAFF_ROLE_ID = '123456789012345678';
process.env.ORDER_CATEGORY_ID = '123456789012345678';

let failures = 0;
const pending = [];
function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(
        result.then(
          () => console.log(`  ✅ ${name}`),
          (err) => {
            failures++;
            console.error(`  ❌ ${name}: ${err.message}`);
          }
        )
      );
    } else {
      console.log(`  ✅ ${name}`);
    }
  } catch (err) {
    failures++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

console.log('✦ X SHOP smoke test\n');

// ── Database + seed ──────────────────────────────────────────────────────────
const { db, getSetting, setSetting } = require('../src/database/db');
const { seed } = require('../src/database/seed');

console.log('Database:');
check('tables created', () => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ['categories', 'products', 'orders', 'order_events', 'payment_methods', 'settings']) {
    if (!tables.includes(t)) throw new Error(`missing table ${t}`);
  }
});

seed();
seed(); // idempotent

check('seeded catalog', () => {
  const cats = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  const prods = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  const pm = db.prepare('SELECT COUNT(*) c FROM payment_methods').get().c;
  if (cats < 5) throw new Error(`expected ≥5 categories, got ${cats}`);
  if (prods < 15) throw new Error(`expected ≥15 products, got ${prods}`);
  if (pm < 3) throw new Error(`expected ≥3 payment methods, got ${pm}`);
  const upi2 = db.prepare("SELECT * FROM payment_methods WHERE key = 'upi2'").get();
  if (!upi2 || upi2.status !== 'active') throw new Error('upi2 method missing or inactive');
  const demo = db.prepare("SELECT 1 FROM payment_methods WHERE key = 'testpay'").get();
  if (demo) throw new Error('demo method testpay should be removed');
});

check('settings get/set', () => {
  setSetting('smoke', '1');
  if (getSetting('smoke') !== '1') throw new Error('roundtrip failed');
});

// ── Config: multiple owners + configurable presence ─────────────────────────
const config = require('../src/config/config');
const presence = require('../src/utils/presence');

console.log('\nConfig:');

check('OWNER_IDS merges with OWNER_ID (deduped + validated)', () => {
  if (!Array.isArray(config.ownerIds)) throw new Error('config.ownerIds is not an array');
  if (config.ownerIds.length !== 3) {
    throw new Error(`expected 3 unique owners, got ${config.ownerIds.length}: ${config.ownerIds.join(', ')}`);
  }
  if (config.ownerId !== config.ownerIds[0]) throw new Error('config.ownerId must mirror the first owner');
  if (config.ownerId !== '123456789012345678') throw new Error('OWNER_ID must stay the primary owner');
  if (config.ownerIds.includes('not-an-id')) throw new Error('invalid owner id was not filtered out');
  if (new Set(config.ownerIds).size !== config.ownerIds.length) throw new Error('duplicates were not removed');
});

check('every owner is DM\'d (one closed DM never blocks the rest)', async () => {
  const notify = require('../src/services/notify');
  const sent = [];
  notify.setClient({
    users: {
      fetch: async (id) => ({
        send: async () => {
          if (id === config.ownerIds[1]) throw new Error('owner has DMs closed');
          sent.push(id);
        },
      }),
    },
  });
  await notify.notifyOwner({ embeds: [] });
  notify.setClient(null);
  if (sent.length !== config.ownerIds.length - 1) {
    throw new Error(`expected ${config.ownerIds.length - 1} delivered DMs, got ${sent.length}`);
  }
});

check('presence defaults are built from .env', () => {
  const p = presence.presenceFor((key) => `[${key}]`);
  if (p.status !== 'online') throw new Error(`unexpected status ${p.status}`);
  if (!Array.isArray(p.activities) || p.activities.length !== 1) throw new Error('expected one activity');
  const a = p.activities[0];
  if (a.name !== '[shop] X SHOP • type "buy"') throw new Error(`unexpected activity name: ${a.name}`);
  if (a.type !== presence.ACTIVITY_TYPES.WATCHING) throw new Error('default activity type must be WATCHING');
  if (a.name.length > 128) throw new Error('activity name must respect the 128 char limit');
  const line = presence.describePresence((key) => `[${key}]`);
  if (!line.startsWith('Watching "') || !line.endsWith('• online')) throw new Error(`odd presence log: ${line}`);
});

check('all activity types + emoji prefix are wired', () => {
  for (const type of ['PLAYING', 'STREAMING', 'LISTENING', 'WATCHING', 'COMPETING']) {
    // `in` not truthiness: ActivityType.Playing is 0.
    if (!(type in presence.ACTIVITY_TYPES)) throw new Error(`missing ActivityType mapping for ${type}`);
    if (!presence.VERBS[type]) throw new Error(`missing log verb for ${type}`);
  }
  if (presence.activityName(() => '') !== 'X SHOP • type "buy"') {
    throw new Error('an empty emoji must not leave a stray prefix space');
  }
});

// ── Data modules ─────────────────────────────────────────────────────────────
const products = require('../src/products/products');
const orders = require('../src/orders/orders');
const methods = require('../src/payments/methods');
const { generateOrderId, slugify } = require('../src/utils/ids');

// Any existing product row — ids are not guaranteed (catalog is editable).
const anyProduct = () => {
  const p = db.prepare('SELECT * FROM products LIMIT 1').get();
  if (!p) throw new Error('no products in database');
  return p;
};

// A product with no order questions — for testing the straight-line flow.
const anySimpleProduct = () => {
  const p = db.prepare("SELECT * FROM products WHERE questions = '[]' LIMIT 1").get();
  if (!p) throw new Error('no question-free products in database');
  return p;
};

console.log('\nData modules:');
check('order id generation + uniqueness', () => {
  const ids = new Set();
  for (let i = 0; i < 200; i++) ids.add(generateOrderId(db));
  if (ids.size !== 200) throw new Error('duplicate order id generated');
  if (!/^XS-[0-9A-F]{6}$/.test([...ids][0])) throw new Error('bad id format');
});

check('slugify', () => {
  if (slugify('Nitro Gift Link!') !== 'nitro-gift-link') throw new Error('unexpected slug');
});

check('product questions parsing', () => {
  const p = products.listProducts(products.findCategoryByName('Gaming').id).find((x) => x.name === 'Free Fire');
  const q = products.questionsOf(p);
  if (q.length !== 3 || q[0].label !== 'Player UID') throw new Error('bad questions');
});

check('order lifecycle', () => {
  const fakeUser = { id: '987654321000000001', username: 'smokeuser' };
  const product = anyProduct();
  const order = orders.createOrder(fakeUser, product);
  if (!/^XS-/.test(order.order_id)) throw new Error('bad order id');

  orders.update(order.order_id, { quantity: 3, total_price: 3 * product.price });
  orders.setStatus(order.order_id, 'awaiting_payment', fakeUser.id, 'test');
  let fresh = orders.getByOrderId(order.order_id);
  if (fresh.order_status !== 'awaiting_payment' || fresh.quantity !== 3) throw new Error('update failed');

  orders.setStatus(order.order_id, 'payment_review', fakeUser.id);
  orders.setStatus(order.order_id, 'processing', fakeUser.id);
  orders.setStatus(order.order_id, 'completed', fakeUser.id);
  fresh = orders.getByOrderId(order.order_id);
  if (fresh.order_status !== 'completed') throw new Error('status chain failed');

  const events = orders.eventsFor(order.order_id);
  if (events.length < 4) throw new Error('events not recorded');
  if (!events.some((e) => e.event === 'status:completed')) throw new Error('status history incomplete');

  orders.update(order.order_id, { answers: JSON.stringify([{ label: 'A', value: 'B' }]) });
  if (orders.answersOf(orders.getByOrderId(order.order_id)).length !== 1) throw new Error('answers failed');

  orders.activeCount(fakeUser.id); // smoke
  orders.getByChannel('no-channel'); // smoke
  orders.stats();
  orders.topProducts();
  orders.topCustomers();

  // cleanup so the shipped DB stays clean
  db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
  db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
});

check('payment methods config logic', () => {
  const upi = methods.get('upi');
  if (methods.isConfigured(upi)) throw new Error('unconfigured upi reported as configured');
  methods.setFields('upi', { upi_id: 'test@upi', name: 'Test' });
  if (!methods.isConfigured(methods.get('upi'))) throw new Error('configured upi not detected');
  methods.setFields('upi', { upi_id: '', name: '' }); // reset
  if (methods.isConfigured(methods.get('upi'))) throw new Error('reset failed');
});

// ── Views (no client needed) ─────────────────────────────────────────────────
const views = require('../src/shop/views');
const flow = require('../src/tickets/flow');
const staff = require('../src/tickets/staff');
const orderViews = require('../src/services/orderViews');
const { progressTracker, fmtMoney, e, COLORS } = require('../src/utils/embeds');

console.log('\nViews & embeds:');
check('public shop panel builds', () => {
  const view = views.shopPanel(products.listCategories());
  if (!view.embeds.length || !view.components.length) throw new Error('empty panel');
  if (view.embeds[0].data.color !== COLORS.black) throw new Error('wrong brand color');
  // Buy menu: one "Select a category" dropdown row + the Shop/Vouches/Deals tab row.
  if (view.components.length !== 2) throw new Error(`expected 2 component rows, got ${view.components.length}`);
  if (view.components[0].components[0].data.custom_id !== 'shop:cat') throw new Error('category menu missing');
  const tabs = view.components[1].components.map((b) => b.data.custom_id);
  if (tabs.join(',') !== 'shop:tab:shop,shop:tab:vouch,shop:tab:deals') {
    throw new Error(`tab row wrong: ${tabs.join(',')}`);
  }
});

check('vouches + deals tabs build (empty and with receipts)', () => {
  const socialProof = require('../src/services/socialProof');

  // Empty state first — the tabs must render before any vouch/deal exists.
  const emptyVouches = views.vouchesTab(socialProof.stats('vouch'), socialProof.listProofs('vouch', 8));
  if (!emptyVouches.embeds.length) throw new Error('empty vouches tab');
  if (!/No vouches yet/.test(emptyVouches.embeds[0].data.description)) throw new Error('vouch empty state missing');
  if (emptyVouches.components[0].components.map((b) => b.data.custom_id).join(',') !==
    'shop:tab:shop,shop:tab:vouch,shop:tab:deals') throw new Error('vouch tab row missing');
  const emptyDeals = views.dealsTab(socialProof.stats('deal'), socialProof.listProofs('deal', 8));
  if (!/No deals yet/.test(emptyDeals.embeds[0].data.description)) throw new Error('deal empty state missing');

  // Record receipts, then the tabs must show them with running totals.
  const v = socialProof.recordProof('vouch', '987654321000000005', '111', '14x Boosts');
  if (v.totalForTarget !== 1 || v.totalAll !== 1) throw new Error('vouch totals wrong');
  socialProof.recordProof('deal', '987654321000000005', '111', 'Nitro Basic GL');
  const vouches = views.vouchesTab(socialProof.stats('vouch'), socialProof.listProofs('vouch', 8));
  if (!/14x Boosts/.test(vouches.embeds[0].data.description)) throw new Error('vouch receipt missing');
  if (!/Most vouched/.test(vouches.embeds[0].data.description)) throw new Error('vouch stats missing');
  const deals = views.dealsTab(socialProof.stats('deal'), socialProof.listProofs('deal', 8));
  if (!/Nitro Basic GL/.test(deals.embeds[0].data.description)) throw new Error('deal receipt missing');

  // Deal post failure must roll the receipt back (removeProof).
  const before = socialProof.countProofs('deal');
  socialProof.removeProof(socialProof.listProofs('deal', 1)[0].id);
  if (socialProof.countProofs('deal') !== before - 1) throw new Error('receipt rollback failed');
});

check('category menu + product details build', () => {
  const cat = products.findCategoryByName('Nitro');
  const list = products.listProducts(cat.id);
  const menu = views.categoryMenu(cat, list);
  if (!menu.components.length) throw new Error('no menu row');
  const details = views.productDetails(cat, list[0], '111');
  const buyBtn = details.components[0].components[0];
  if (buyBtn.data.custom_id !== `shop:buy:${list[0].id}:111`) throw new Error('buy button id wrong');
});

check('ticket flow views build', () => {
  const fakeUser = { id: '987654321000000002', username: 'smokeuser2' };
  const product = anySimpleProduct();
  const order = orders.createOrder(fakeUser, product);
  const qv = flow.quantityView(order, product);
  if (qv.components.length !== 2) throw new Error('quantity view rows wrong');
  if (flow.viewForOrder(order, product).components.length < 1) throw new Error('viewForOrder failed');

  // Quantity is only "confirmed" once the quantity_selected event exists.
  orders.update(order.order_id, { quantity: 2, total_price: 2 * product.price });
  orders.addEvent(order.order_id, 'quantity_selected', fakeUser.id, '2');
  let fresh = orders.getByOrderId(order.order_id);
  const pv = flow.viewForOrder(fresh, product);
  if (!pv.embeds[0].data.title.toLowerCase().includes('payment')) throw new Error('expected payment select');

  orders.update(order.order_id, { payment_method: 'upi' });
  fresh = orders.getByOrderId(order.order_id);
  const sv = flow.viewForOrder(fresh, product);
  if (!sv.embeds[0].data.title.toLowerCase().includes('confirm')) throw new Error('expected summary');

  const payment = flow.paymentView ? null : null; // paymentView is internal; summary is enough
  if (!sv.components.length) throw new Error('summary rows missing');

  db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
  db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
});

check('staff panel builds', () => {
  const fakeUser = { id: '987654321000000003', username: 'smokeuser3' };
  const product = anyProduct();
  const order = orders.createOrder(fakeUser, product);
  const embed = staff.panelEmbed(order);
  const rows = staff.panelRows(order);
  if (!/payment review/i.test(embed.data.title)) throw new Error('bad panel title');
  const buttonCount = rows.reduce((n, row) => n + row.components.length, 0);
  if (buttonCount < 5) throw new Error(`missing staff buttons (${buttonCount})`);
  db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
  db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
});

check('order embeds build', () => {
  const fakeUser = { id: '987654321000000004', username: 'smokeuser4' };
  const product = anyProduct();
  const order = orders.createOrder(fakeUser, product);
  orderViews.newOrderEmbed(order, { name: 'order-test' });
  orderViews.paymentSelectedEmbed(order);
  orderViews.proofUploadedEmbed(order);
  orderViews.paymentApprovedEmbed(order);
  orderViews.paymentRejectedEmbed(order, 'bad proof', '123');
  orderViews.orderCompletedLog(order, '123');
  orderViews.orderInfoEmbed(order, []);
  orderViews.paymentInfoEmbed(order);
  db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
  db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
});

check('progress tracker stages', () => {
  const t = (status, qty = 0, pm = null) =>
    progressTracker({ order_status: status, quantity: qty, payment_method: pm });
  // Pending always has an active step (step 1 "Product" is pre-marked done).
  if (!t('pending').includes(e('pending'))) throw new Error('pending has no active step mark');
  // Completed order: every step marked done.
  const done = t('completed', 2, 'upi');
  if (!done.includes(e('completed'))) throw new Error('completed marks wrong');
  if (done.includes(e('pending'))) throw new Error('completed still shows an active step');
});

check('money formatting', () => {
  const cur = require('../src/config/config').currency;
  if (fmtMoney(598) !== `${cur}598`) throw new Error(`integer format: ${fmtMoney(598)}`);
  if (fmtMoney(1299.5) !== `${cur}1,299.50`) throw new Error(`decimal format: ${fmtMoney(1299.5)}`);
});

// ── Public shop interaction handlers ────────────────────────────────────────
// Regression: string select menus carry the selected id in interaction.values[0]
// (not the customId) — selecting a category/product must resolve a real row.

console.log('\nShop interactions:');
check('product select → buy button → wrong-user guard (buy panel keeps the classic flow)', () => {
  const shopHandlers = require('../src/shop/handlers');
  const nitro = products.findCategoryByName('Nitro');
  const updates = [];
  const mock = (customId, values, userId = '111') => ({
    customId,
    values,
    user: { id: userId },
    update: (payload) => updates.push(payload),
    reply: (payload) => updates.push({ ephemeralReply: payload }),
  });

  // 0. The classic buy panel: category select still opens the product menu
  shopHandlers.handleComponent(mock('shop:cat', [String(nitro.id)]));
  const catPayload = updates[0];
  if (!catPayload || !catPayload.components) throw new Error('category menu did not render');
  const productMenu = catPayload.components[0].components[0];
  const productValue =
    productMenu.data?.options?.[0]?.value ||
    productMenu.options?.[0]?.value ||
    (productMenu.toJSON ? productMenu.toJSON().options[0].value : undefined);
  if (!productValue) throw new Error('product select menu has no options');

  // 1. Customer picks the first product in the panel menu
  shopHandlers.handleComponent(mock('shop:prod', [productValue]));
  const prodPayload = updates[1];
  if (!prodPayload || !prodPayload.components) throw new Error('product details did not render');
  const buyButton = prodPayload.components[0].components[0];
  if (!buyButton.data.custom_id.startsWith('shop:buy:')) throw new Error('buy button missing');

  // 2. A different user clicking that Buy button must be rejected ephemerally
  shopHandlers.handleComponent(mock(buyButton.data.custom_id, [], '999'));
  if (!updates[2].ephemeralReply) throw new Error('wrong-user buy not rejected');

  // 3. Back navigation still works
  shopHandlers.handleComponent(mock('shop:back:cats'));
  if (!updates[3] || !updates[3].components) throw new Error('back to categories failed');
});

check('category select → ticket opens → product picked inside → quantity stepper', async () => {
  const shopHandlers = require('../src/shop/handlers');
  const flow = require('../src/tickets/flow');
  const config = require('../src/config/config');
  const { db } = require('../src/database/db');
  const nitro = products.findCategoryByName('Nitro');
  config.ticketCooldownMs = 0; // the pending-ticket guard is what we test here

  let chanCount = 0;
  const makeChannel = (name) => {
    const chan = {
      id: `chan-${++chanCount}`,
      name,
      sent: [],
      updated: null,
      client: {},
      setName: async () => {},
      delete: async () => {},
      send: async (payload) => {
        chan.sent.push(payload);
        return { id: `msg-${chan.sent.length}` };
      },
      permissionsFor: () => ({ has: () => true }),
    };
    return chan;
  };

  const replies = [];
  const registry = new Map(); // channelId -> channel, shared across this test
  const interaction = (customId, values, userId, chan) => ({
    customId,
    values,
    user: { id: userId, username: `buyer${userId}`, tag: `buyer${userId}#0001` },
    client: { user: { id: 'bot-id' } },
    channel: chan,
    message: { id: 'flow-msg-1' },
    chan,
    guild: {
      name: 'Smoke Guild',
      roles: {
        everyone: { id: 'everyone-id' },
        cache: { get: () => ({ id: 'staff-role-id' }) },
      },
      channels: {
        create: async ({ name }) => {
          chan.name = name;
          registry.set(chan.id, chan);
          return chan;
        },
        fetch: async (id) => {
          const found = registry.get(id);
          if (!found) throw new Error('unknown channel');
          return found;
        },
      },
    },
    deferReply: async () => {},
    editReply: (payload) => replies.push(payload),
    reply: (payload) => replies.push(payload),
    update: (payload) => {
      chan.updated = payload;
      return payload;
    },
  });

  // 1. Customer picks a category on the !buysetup panel → their ticket opens
  const chan1 = makeChannel('pending');
  const open = interaction('bst:cat', [String(nitro.id)], '424', chan1);
  await shopHandlers.handleComponent(open);
  const pickMsg = chan1.sent[0];
  if (!pickMsg || !pickMsg.components) throw new Error('pick-product view was not posted in the ticket');
  const pickMenu = pickMsg.components[0].components[0];
  const pickId = pickMenu.data?.custom_id || pickMenu.customId || pickMenu.toJSON().custom_id;
  if (pickId !== `ord:pick:${nitro.id}`) throw new Error(`pick menu id wrong: ${pickId}`);
  if (!replies.some((r) => /ticket is ready/i.test(JSON.stringify(r)))) throw new Error('no ticket-ready confirmation');
  const orderCountBefore = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  if (flow.getPendingPickChannel('424') !== chan1.id) throw new Error('pending pick not registered');

  // 2. Customer picks the product INSIDE the ticket → order + quantity stepper
  const productId = String(products.listProducts(nitro.id)[0].id);
  await flow.handleComponent(interaction(`ord:pick:${nitro.id}`, [productId], '424', chan1));
  const updated = chan1.updated;
  if (!updated || !updated.components) throw new Error('quantity stepper did not replace the pick view');
  const orderCountAfter = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  if (orderCountAfter !== orderCountBefore + 1) throw new Error('pick did not create exactly one order');
  const orderRow = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  if (orderRow.product_id !== Number(productId)) throw new Error('order created with the wrong product');
  if (orderRow.ticket_channel_id !== chan1.id) throw new Error('order not linked to the ticket channel');
  if (orderRow.flow_message_id !== 'flow-msg-1') throw new Error('flow message not recorded');
  if (flow.getPendingPickChannel('424') !== null) throw new Error('pending pick not cleared after ordering');

  // 3. While a customer is still picking (no order yet), a second ticket is refused
  replies.length = 0;
  const chan2 = makeChannel('pending');
  await shopHandlers.handleComponent(interaction('bst:cat', [String(nitro.id)], '425', chan2));
  if (!replies.some((r) => /ticket is ready/i.test(JSON.stringify(r)))) throw new Error('second customer ticket failed');
  replies.length = 0;
  const chan3 = makeChannel('pending');
  await shopHandlers.handleComponent(interaction('bst:cat', [String(nitro.id)], '425', chan3));
  if (!replies.some((r) => /already have an open ticket/i.test(JSON.stringify(r)))) {
    throw new Error('second ticket not refused');
  }
  if (chan3.sent.length) throw new Error('refused ticket still received the pick view');

  // 4. Tabs on the !buysetup panel keep the ticket flavour (bst: ids)
  const tabbed = interaction('bst:tab:vouch', [], '424', makeChannel('panel'));
  await shopHandlers.handleComponent(tabbed);
  const tabButtons = tabbed.chan.updated.components[0].components[0];
  const tabId = tabButtons.data?.custom_id || tabButtons.customId;
  if (!tabId.startsWith('bst:tab:')) throw new Error(`tab row lost the ticket flavour: ${tabId}`);

  // 5. The Buy Now button: ticket opens with the buy menu (all categories)
  const shopViews = require('../src/shop/views');
  const panelIds = (panel) =>
    panel.components.flatMap((r) => r.components.map((c) => c.data?.custom_id || c.toJSON?.().custom_id));
  if (!panelIds(shopViews.shopPanel(products.listCategories(), true)).includes('bst:buynow')) {
    throw new Error('Buy Now button missing from the !buysetup panel');
  }
  if (panelIds(shopViews.shopPanel(products.listCategories())).includes('bst:buynow')) {
    throw new Error('classic buy panel must not have the Buy Now button');
  }
  const chan4 = makeChannel('pending');
  await shopHandlers.handleComponent(interaction('bst:buynow', [], '426', chan4));
  const menuMsg = chan4.sent[0];
  if (!menuMsg || !menuMsg.components) throw new Error('Buy Now ticket has no buy menu');
  const catMenu = menuMsg.components[0].components[0];
  const catMenuId = catMenu.data?.custom_id || catMenu.customId;
  if (catMenuId !== 'ord:pickcat') throw new Error(`buy menu has the wrong select: ${catMenuId}`);
  if (flow.getPendingPickChannel('426') !== chan4.id) throw new Error('Buy Now pending pick not registered');

  // 6. Category picked inside the Buy Now ticket → product picker, then order
  await flow.handleComponent(interaction('ord:pickcat', [String(nitro.id)], '426', chan4));
  const updatedMenu = chan4.updated;
  if (!updatedMenu || !updatedMenu.components) throw new Error('product picker did not replace the buy menu');
  const pickMenu2 = updatedMenu.components[0].components[0];
  const pickMenu2Id = pickMenu2.data?.custom_id || pickMenu2.customId;
  if (pickMenu2Id !== `ord:pick:${nitro.id}`) throw new Error(`product picker id wrong: ${pickMenu2Id}`);

  const countBeforeBuyNow = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  await flow.handleComponent(interaction(`ord:pick:${nitro.id}`, [productId], '426', chan4));
  const buyNowOrder = db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 1').get();
  if (db.prepare('SELECT COUNT(*) c FROM orders').get().c !== countBeforeBuyNow + 1) {
    throw new Error('Buy Now pick did not create the order');
  }
  if (buyNowOrder.ticket_channel_id !== chan4.id) throw new Error('Buy Now order not linked to its ticket');

  // Cleanup — this check created orders and tickets the sweep doesn't know.
  for (const uid of ['424', '426']) {
    db.prepare('DELETE FROM order_events WHERE order_id IN (SELECT order_id FROM orders WHERE discord_user_id = ?)').run(uid);
    db.prepare('DELETE FROM orders WHERE discord_user_id = ?').run(uid);
  }
  flow.clearPendingPick('424');
  flow.clearPendingPick('425');
  flow.clearPendingPick('426');
});

check('nitro catalog matches the storefront spec', () => {
  const nitro = products.findCategoryByName('Nitro');
  const names = products.listProducts(nitro.id).map((p) => p.name);
  for (const expected of [
    '14x Boosts', '28x Boosts', 'Nitro Booster GL', 'Nitro Basic GL',
    'Nitro ID — 1 Month', 'Nitro ID — 3 Months', 'Nitro VCC', 'Nitro Promo', 'Nitro Deco',
  ]) {
    if (!names.includes(expected)) throw new Error(`missing product: ${expected}`);
  }
});

check('component emojis are Discord-valid (no INVALID_EMOJI crashes)', () => {
  const { parseEmoji } = require('discord.js');
  const views = require('../src/shop/views');
  const flow = require('../src/tickets/flow');

  // Build every public view with deliberately hostile emoji data (₿ ✦ etc.)
  const cats = products.listAllCategories().map((c) => ({ ...c, emoji: c.name === 'Bitcoin' ? '₿' : c.emoji }));
  const gather = (payload) => {
    for (const row of payload.components || []) {
      for (const comp of row.components) {
        const json = comp.toJSON();
        const emojis = [];
        if (json.emoji) emojis.push(json.emoji);
        for (const opt of json.options || []) if (opt.emoji) emojis.push(opt.emoji);
        for (const em of emojis) {
          if (em.id) continue; // custom guild emoji — always valid
          if (!parseEmoji(em.name)) throw new Error(`invalid component emoji: ${JSON.stringify(em)}`);
        }
      }
    }
  };

  gather(views.shopPanel(cats));
  const nitro = products.findCategoryByName('Nitro');
  gather(views.categoryMenu(nitro, products.listProducts(nitro.id)));
  gather(views.productDetails(nitro, products.listProducts(nitro.id)[0], '111'));

  // Tab screens — empty and with receipts — must also emit usable emojis only.
  const socialProof = require('../src/services/socialProof');
  gather(views.vouchesTab(socialProof.stats('vouch'), socialProof.listProofs('vouch', 8)));
  gather(views.dealsTab(socialProof.stats('deal'), socialProof.listProofs('deal', 8)));
  socialProof.recordProof('vouch', '999999999999999999', '111', 'Robux');
  socialProof.recordProof('deal', '999999999999999999', '111', 'Netflix');
  gather(views.vouchesTab(socialProof.stats('vouch'), socialProof.listProofs('vouch', 8)));
  gather(views.dealsTab(socialProof.stats('deal'), socialProof.listProofs('deal', 8)));
  for (const row of socialProof.listProofs('vouch', 8)) socialProof.removeProof(row.id);
  for (const row of socialProof.listProofs('deal', 8)) socialProof.removeProof(row.id);

  // Payment select with a '₿'-emoji method must not crash either
  const fakeOrder = {
    order_id: 'XS-EMOJI01', discord_user_id: '111', product_name: 'x', quantity: 1,
    unit_price: 1, total_price: 1, order_status: 'pending',
  };
  const methodsMod = require('../src/payments/methods');
  const originalList = methodsMod.listActive;
  methodsMod.listActive = () => [
    { key: 'bitcoin', label: 'Bitcoin', emoji: '₿', config: '{"wallet":"x"}', instructions: 'i', status: 'active' },
  ];
  try {
    gather(flow.paymentSelectView(fakeOrder));
  } finally {
    methodsMod.listActive = originalList;
  }
});


// ── Ticket flow acknowledgment (regression: InteractionNotReplied) ───────────
// A button interaction MUST be deferred/replied/updated before editReply —
// this mock enforces discord.js' real semantics and walks the whole flow.

console.log('\nTicket flow:');
check('quantity stepper → payment → confirm → paid (all acknowledged)', async () => {
  const flow = require('../src/tickets/flow');

  const product = anySimpleProduct();
  const user = { id: '555000111', username: 'flowuser' };
  let order = orders.createOrder(user, product);

  const log = [];
  const mk = (customId, values) => {
    const state = { deferred: false, replied: false };
    return {
      customId,
      values,
      user: { id: user.id },
      channel: {
        send(payload) {
          if (!state.replied && !state.deferred) throw new Error('channel.send before acknowledge');
          log.push(['channelSend', payload]);
        },
      },
      deferUpdate() {
        if (state.replied) throw new Error('deferUpdate after reply');
        state.deferred = true;
      },
      editReply(payload) {
        if (!state.deferred && !state.replied) throw new Error('InteractionNotReplied');
        log.push(['editReply', payload]);
      },
      followUp(payload) {
        if (!state.deferred && !state.replied) throw new Error('followUp before acknowledge');
        log.push(['followUp', payload]);
      },
      update(payload) {
        if (state.replied) throw new Error('double update');
        state.replied = true;
        log.push(['update', payload]);
      },
      reply(payload) {
        if (state.replied) throw new Error('double reply');
        state.replied = true;
        log.push(['reply', payload]);
      },
      showModal() {
        if (state.replied) throw new Error('double acknowledge');
        state.replied = true;
      },
    };
  };

  try {
    // 1. Customer steps the quantity up (min → min+1) and presses Next
    await flow.handleComponent(mk(`ord:qp:${order.order_id}`));
    order = orders.getByOrderId(order.order_id);
    const steppedQty = order.quantity;
    if (steppedQty !== Math.max(1, product.minimum_quantity || 1) + 1) {
      throw new Error(`stepper did not persist quantity (got ${order.quantity})`);
    }
    await flow.handleComponent(mk(`ord:next:${order.order_id}`));
    order = orders.getByOrderId(order.order_id);
    if (!orders.hasEvent(order.order_id, 'quantity_selected')) throw new Error('quantity not confirmed');

    // 2. Customer selects the second UPI method
    await flow.handleComponent(mk(`ord:pay:${order.order_id}`, ['upi2']));
    order = orders.getByOrderId(order.order_id);
    if (order.payment_method !== 'upi2') throw new Error('payment method not saved');

    // 3. Customer confirms the order → payment page
    await flow.handleComponent(mk(`ord:ok:${order.order_id}`));
    const titles = log
      .filter((l) => Array.isArray(l) && l[1]?.embeds?.length)
      .map(([, p]) => p.embeds[0].data?.title || p.embeds[0].title || '');
    if (!titles.some((t) => String(t).toUpperCase().includes('PAYMENT'))) {
      throw new Error(`payment page not rendered (${titles.join(' | ')})`);
    }

    // 4. "I've Paid" → ephemeral ack + proof-request message in the ticket
    const before = log.length;
    await flow.handleComponent(mk(`ord:paid:${order.order_id}`));
    if (!log.slice(before).some((l) => l[0] === 'reply')) throw new Error('no ephemeral ack for I\'ve Paid');
    if (!log.slice(before).some((l) => l[0] === 'channelSend')) throw new Error('proof request not posted');
    if (!orders.hasEvent(order.order_id, 'customer_paid_ack')) throw new Error('paid ack not recorded');
  } finally {
    db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
    db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
  }
});

check('payment review panel → owner DMs, never the ticket', async () => {
  const logs = require('../src/services/logs');
  const reviewPanel = require('../src/services/reviewPanel');
  const config = require('../src/config/config');

  if (config.review.target !== 'dm') throw new Error(`expected default target dm, got ${config.review.target}`);

  const product = anyProduct();
  const order = orders.createOrder({ id: '444444444444444444', username: 'panel-check' }, product);
  const TICKET = '555555555555555555';
  orders.update(order.order_id, { ticket_channel_id: TICKET, quantity: 1, total_price: product.price });

  const posts = [];
  const dmPosts = [];
  const fetchedIds = [];
  let edits = 0;
  const fakeClient = {
    channels: {
      fetch: async (id) => ({
        id,
        isTextBased: () => true,
        send: async (payload) => {
          posts.push({ id, payload });
          return { id: `msg-${posts.length}`, channelId: id };
        },
        messages: {
          fetch: async (mid) => {
            fetchedIds.push(`${id}:${mid}`);
            return { edit: async () => { edits++; }, delete: async () => {} };
          },
        },
      }),
    },
    users: {
      fetch: async (id) => ({
        id,
        send: async (payload) => {
          dmPosts.push({ id, payload });
          return { id: `dm-${dmPosts.length}`, channelId: `dmchan-${id}` };
        },
      }),
    },
  };

  try {
    logs.setClient(fakeClient);
    const res = await reviewPanel.postReviewPanel(order);
    const fresh = orders.getByOrderId(order.order_id);
    await reviewPanel.refreshReviewPanel(fresh);

    if (!res.ok) throw new Error('panel was not delivered anywhere');
    if (posts.some((p) => p.id === TICKET)) throw new Error('panel was posted INSIDE the customer ticket!');
    if (dmPosts.length !== config.ownerIds.length) {
      throw new Error(`expected ${config.ownerIds.length} owner DMs, got ${dmPosts.length}`);
    }
    const title = dmPosts[0].payload.embeds[0].data?.title ?? dmPosts[0].payload.embeds[0].title;
    if (!String(title).includes('Payment Review')) throw new Error(`unexpected panel title: ${title}`);
    if (!fresh.review_channel_id || !fresh.staff_panel_message_id) {
      throw new Error('panel location (review_channel_id + message id) was not stored');
    }
    if (edits !== 1) throw new Error(`refresh must edit the stored panel (edits=${edits})`);
    if (fetchedIds.some((f) => f.startsWith(`${TICKET}:`))) {
      throw new Error('refresh/panel lookups must never touch the ticket channel');
    }
  } finally {
    logs.setClient(null);
    db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
    db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
  }
});

check('no raw emoji tags in plain-text component fields', () => {
  // Discord renders select placeholders, option labels/descriptions and button
  // labels as PLAIN TEXT — a `<:Name:id>` tag is displayed literally there.
  const shopViews = require('../src/shop/views');
  const flow = require('../src/tickets/flow');
  const category = products.listCategories()[0];
  const product = anyProduct();
  const order = orders.createOrder({ id: '777777777777777777', username: 'ui-check' }, product);
  try {
    orders.update(order.order_id, { quantity: 2, total_price: product.price * 2 });
    const payloads = [
      shopViews.shopPanel(products.listCategories()),
      shopViews.categoryMenu(category, products.listProducts(category.id)),
      shopViews.productDetails(category, product, '111111111111111111'),
      flow.paymentSelectView(orders.getByOrderId(order.order_id)),
      flow.quantityView(orders.getByOrderId(order.order_id), product),
    ];
    const TAG = /<a?:\w{2,32}:\d{17,20}>/;
    const bad = [];
    for (const payload of payloads) {
      for (const row of payload.components || []) {
        for (const comp of row.components || []) {
          const d = comp.data ?? comp;
          if (d.placeholder && TAG.test(d.placeholder)) bad.push(`placeholder "${d.placeholder}"`);
          for (const opt of d.options || []) {
            if (TAG.test(opt.label || '')) bad.push(`option label "${opt.label}"`);
            if (TAG.test(opt.description || '')) bad.push(`option description "${opt.description}"`);
          }
          if (d.type === 2 && TAG.test(d.label || '')) bad.push(`button label "${d.label}"`);
        }
      }
    }
    if (bad.length) throw new Error(`emoji tag would render literally → ${bad.join(' | ')}`);
  } finally {
    db.prepare('DELETE FROM order_events WHERE order_id = ?').run(order.order_id);
    db.prepare('DELETE FROM orders WHERE order_id = ?').run(order.order_id);
  }
});

check('slash registration survives an unknown GUILD_ID', async () => {
  const slash = require('../src/slash');
  const calls = [];
  const fakeClient = {
    // The bot is in NO guild (e.g. kicked, or GUILD_ID belongs to another bot).
    guilds: {
      cache: new Map(),
      fetch: async (id) => {
        calls.push(id);
        throw new Error('Unknown Guild');
      },
    },
    application: { commands: { set: async () => calls.push('global') } },
  };

  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(' '));
  try {
    await slash.registerSlashCommands(fakeClient);
  } finally {
    console.warn = orig;
  }

  if (calls.length) throw new Error(`hit the API for a guild the bot is not in: ${calls.join(', ')}`);
  if (!warns.some((w) => /not in any server/.test(w))) throw new Error('expected a clear "not in any server" warning');
  if (!warns.some((w) => w.includes('Invite:'))) throw new Error('expected an invite link in the warning');
});

// ── Command registry ─────────────────────────────────────────────────────────
const commands = require('../src/commands');

console.log('\nCommands:');
check('all spec commands registered', () => {
  const expected = [
    'addcategory', 'editcategory', 'deletecategory',
    'addproduct', 'editproduct', 'deleteproduct', 'setprice', 'setstock', 'setquestions',
    'setpayment', 'setpayfield', 'setqr', 'payments', 'delpayment', 'togglepayment',
    'orders', 'order', 'stats', 'refund',
    'close', 'cancel', 'note',
    'maintenance', 'panel', 'xhelp', 'ping', 'categories', 'products', 'help', 'doctor',
    'setemoji', 'resetemoji', 'emojis', 'emojiscan', 'autoemojis', 'addemoji', 'delemoji',
    'setbanner', 'setlogo',
  ];
  const missing = expected.filter((c) => !commands.registry.has(c));
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
});

check('argument parsers', () => {
  const { pipeArgs, kvArgs, toNumber } = require('../src/utils/parse');
  if (pipeArgs('a | b | c').join(',') !== 'a,b,c') throw new Error('pipeArgs');
  const { id, values } = kvArgs('5 price=199 status=hidden');
  if (id !== '5' || values.price !== '199' || values.status !== 'hidden') throw new Error('kvArgs');
  if (toNumber('₹299') !== 299) throw new Error('toNumber');
});

// ── Cleanup + result ─────────────────────────────────────────────────────────
// Wait for any async checks to settle before reporting / exiting.
Promise.all(pending)
  .catch(() => {})
  .then(() => {
    const leftovers = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
    console.log(`\nOrders remaining in DB after cleanup: ${leftovers}`);
    console.log(failures === 0 ? '\n✦ ALL CHECKS PASSED' : `\n✗ ${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
  });
