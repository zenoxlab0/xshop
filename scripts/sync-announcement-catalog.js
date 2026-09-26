'use strict';

/**
 * One-off sync: applies the Discord announcement catalog to the LIVE database.
 * - Renames/re-describes the 6 Nitro products to match the XShop™ announcements
 * - Adds a "Server Invite Link" order question to both boost packages
 * - Turns "Coming Soon" (More category) into a non-buyable teaser
 * - Removes the leftover smoke-test setting
 *
 * Safe to re-run (idempotent). Run from the project root:
 *   node scripts/sync-announcement-catalog.js
 */

const { db } = require('../src/database/db');

const BOOST_QUESTIONS = JSON.stringify([
  { label: 'Server Invite Link', style: 'short', required: true },
]);

const nitroUpdates = [
  {
    find: 'Server Boost 14x',
    name: '14x Boosts',
    emoji: '🚀',
    description: [
      '**PREMIUM SERVER BOOSTS — FAST & RELIABLE**',
      "14 boosts for your server with quick delivery — we've got you covered.",
      '',
      '» Fast Delivery',
      '» Reliable Service',
      '» Bulk Orders Available',
      '» Server Level Support',
      '» Order Assistance Available',
      '',
      '_Need more boosts? Contact us for custom quantities._',
    ].join('\n'),
    questions: BOOST_QUESTIONS,
  },
  {
    find: 'Server Boost 28x',
    name: '28x Boosts',
    emoji: '🚀',
    description: [
      '**PREMIUM SERVER BOOSTS — FAST & RELIABLE**',
      '28 boosts — best value package with quick delivery.',
      '',
      '» Fast Delivery',
      '» Reliable Service',
      '» Bulk Orders Available',
      '» Server Level Support',
      '» Order Assistance Available',
      '',
      '_Need more boosts? Contact us for custom quantities._',
    ].join('\n'),
    questions: BOOST_QUESTIONS,
  },
  {
    find: 'Nitro Booster Gift Link',
    name: 'Nitro Booster GL',
    emoji: '🎁',
    description: [
      '**GENUINE NITRO GIFT LINK — FAST & RELIABLE**',
      'Nitro Booster (full plan) gift link with quick delivery.',
      '',
      '» Fast Delivery',
      '» Genuine Gift Links',
      '» Bulk Orders Available',
      '» Order Assistance Available',
      '» Warranty Available',
      '',
      '_Need multiple gift links? Contact us for custom quantities._',
    ].join('\n'),
    questions: '[]',
  },
  {
    find: 'Nitro Basic Gift Link',
    name: 'Nitro Basic GL',
    emoji: '🎁',
    description: [
      '**GENUINE NITRO GIFT LINK — FAST & RELIABLE**',
      'Nitro Basic gift link with quick delivery.',
      '',
      '» Fast Delivery',
      '» Genuine Gift Links',
      '» Bulk Orders Available',
      '» Order Assistance Available',
      '» Warranty Available',
      '',
      '_Need multiple gift links? Contact us for custom quantities._',
    ].join('\n'),
    questions: '[]',
  },
  {
    find: 'Nitro ID — 1 Month',
    name: 'Nitro ID — 1 Month',
    emoji: '🪪',
    description: [
      '**PREMIUM NITRO ID — AFFORDABLE & RELIABLE**',
      '1 month of full Nitro perks on a ready account ID.',
      '',
      '» Fast Delivery',
      '» Reliable Service',
      '» Bulk Orders Available',
      '» Order Assistance Available',
      '',
      '_Need multiple IDs? Contact us for bulk orders._',
    ].join('\n'),
    questions: '[]',
  },
  {
    find: 'Nitro ID — 3 Months',
    name: 'Nitro ID — 3 Months',
    emoji: '🪪',
    description: [
      '**PREMIUM NITRO ID — AFFORDABLE & RELIABLE**',
      '3 months of full Nitro perks on a ready account ID — best value.',
      '',
      '» Fast Delivery',
      '» Reliable Service',
      '» Bulk Orders Available',
      '» Order Assistance Available',
      '',
      '_Need multiple IDs? Contact us for bulk orders._',
    ].join('\n'),
    questions: '[]',
  },
];

const COMING_SOON_DESCRIPTION = [
  '**NEW PRODUCT — COMING SOON**',
  "Something big is on the way. We're working on something new, premium & affordable for you.",
  '',
  '» High-Quality Service',
  '» Affordable Pricing',
  '» Trusted & Reliable',
  '» More Options',
  '» Bigger Stock',
  '» Better Experience',
  '',
  '**Status:** Coming Soon • Stay Tuned • More Details Soon™',
].join('\n');

const run = db.transaction(() => {
  const nitro = db.prepare(
    `SELECT p.id, p.name FROM products p JOIN categories c ON c.id = p.category_id
     WHERE c.name = 'Nitro'`
  ).all();

  const update = db.prepare(`
    UPDATE products
    SET name = ?, emoji = ?, description = ?, questions = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  let updated = 0;
  for (const item of nitroUpdates) {
    const row = nitro.find((p) => p.name === item.find);
    if (!row) {
      console.log(`⚠️  Skipped (not found in Nitro category): ${item.find}`);
      continue;
    }
    update.run(item.name, item.emoji, item.description, item.questions, row.id);
    console.log(`✅ Nitro #${row.id}: ${item.find} → ${item.name} (${item.emoji})`);
    updated++;
  }

  const comingSoon = db.prepare(`
    SELECT p.id FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.name = 'Coming Soon' AND c.name = 'More'
  `).get();
  if (comingSoon) {
    db.prepare(`
      UPDATE products
      SET description = ?, stock = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(COMING_SOON_DESCRIPTION, comingSoon.id);
    console.log(`✅ More #${comingSoon.id}: Coming Soon teaser updated (stock 0 → not buyable yet).`);
  } else {
    console.log('⚠️  Skipped: no "Coming Soon" product in the More category.');
  }

  db.prepare(`DELETE FROM settings WHERE key = 'smoke'`).run();
  console.log('✅ Removed leftover smoke-test setting (if any).');

  // ── Payment methods ────────────────────────────────────────────────────────
  // Remove the demo/test method and add the second UPI wallet.
  const removed = db.prepare(`DELETE FROM payment_methods WHERE key = 'testpay'`).run();
  if (removed.changes) console.log('🗑️  Removed demo payment method (testpay).');

  const hasUpi2 = db.prepare(`SELECT 1 FROM payment_methods WHERE key = 'upi2'`).get();
  if (!hasUpi2) {
    db.prepare(
      `INSERT INTO payment_methods (key, label, emoji, config, instructions, position)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      'upi2',
      'UPI 2',
      '🇮🇳',
      '{}',
      'Pay via UPI (alternate wallet) and upload the payment screenshot.',
      2
    );
    console.log('✅ Added payment method: 🇮🇳 UPI 2 (key: upi2)');
    console.log('   → configure it with: !setpayfield upi2 upi_id=yourname@upi name=Your Name');
  }

  // '₿' is a currency symbol, not an emoji — Discord rejects it in components.
  db.prepare(`UPDATE payment_methods SET emoji = '🟠' WHERE key = 'bitcoin' AND emoji = '₿'`).run();

  // Spec §22 catalog completeness: Nitro VCC / Nitro Promo / Nitro Deco.
  const insertProduct = db.prepare(
    `INSERT INTO products (category_id, name, emoji, description, price, stock, questions)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const nitroCat = db.prepare(`SELECT id FROM categories WHERE name = 'Nitro'`).get();
  if (nitroCat) {
    const missing = [
      ['Nitro VCC', '💳', 'Virtual card topped up for Nitro purchases. Ask staff for availability.', 8, JSON.stringify([{ label: 'Discord account email', style: 'short', required: true }])],
      ['Nitro Promo', '🎟️', 'Discounted Nitro promo codes — limited stock.', 3, '[]'],
      ['Nitro Deco', '🎨', 'Profile decoration / avatar decoration codes.', 1.5, '[]'],
    ];
    for (const [name, emoji, description, price, questions] of missing) {
      const exists = db
        .prepare('SELECT 1 FROM products WHERE category_id = ? AND name = ?')
        .get(nitroCat.id, name);
      if (!exists) {
        insertProduct.run(nitroCat.id, name, emoji, description, price, -1, questions);
        console.log(`✅ Added Nitro product: ${emoji} ${name}`);
      }
    }
  }
  return updated;
});

const updated = run();
console.log(`\nDone — ${updated}/6 Nitro products synced with the announcements.`);
