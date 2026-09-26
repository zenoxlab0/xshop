'use strict';

const { db } = require('./db');

/**
 * Seeds the default X SHOP catalog (categories, products, payment methods)
 * the first time the bot starts. Everything stays editable through admin
 * commands — the shop engine never hard-codes products.
 */
function seed() {
  const seedMethods = db.transaction(() => {
    const count = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
    if (count === 0) {
      const insertCategory = db.prepare(
        'INSERT INTO categories (name, emoji, description, position) VALUES (?, ?, ?, ?)'
      );
      const insertProduct = db.prepare(
        `INSERT INTO products (category_id, name, emoji, description, price, stock, questions)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );

      const catalog = [
        {
          name: 'Nitro',
          emoji: '🚀',
          description: 'Discord Nitro products',
          products: [
            ['14x Boosts', '🚀', 'Premium server boosts — fast & reliable delivery.\n\n» Fast Delivery\n» Reliable Service\n» Bulk Orders Available\n» Server Level Support\n» Order Assistance Available\n\n_Need more boosts? Contact us for custom quantities._', 2.5, JSON.stringify([{ label: 'Server Invite Link', style: 'short', required: true }])],
            ['28x Boosts', '🚀', 'Premium server boosts — best value package, fast & reliable delivery.\n\n» Fast Delivery\n» Reliable Service\n» Bulk Orders Available\n» Server Level Support\n» Order Assistance Available\n\n_Need more boosts? Contact us for custom quantities._', 5, JSON.stringify([{ label: 'Server Invite Link', style: 'short', required: true }])],
            ['Nitro Booster GL', '🎁', 'Genuine Nitro Booster (full plan) gift link — fast delivery with warranty.\n\n» Fast Delivery\n» Genuine Gift Links\n» Bulk Orders Available\n» Order Assistance Available\n» Warranty Available\n\n_Need multiple gift links? Contact us for custom quantities._', 5.5, '[]'],
            ['Nitro Basic GL', '🎁', 'Genuine Nitro Basic gift link — fast delivery with warranty.\n\n» Fast Delivery\n» Genuine Gift Links\n» Bulk Orders Available\n» Order Assistance Available\n» Warranty Available\n\n_Need multiple gift links? Contact us for custom quantities._', 2, '[]'],
            ['Nitro ID — 1 Month', '🪪', 'Nitro on a ready account ID — 1 month of full Nitro perks.\n\n» Fast Delivery\n» Reliable Service\n» Bulk Orders Available\n» Order Assistance Available\n\n_Need multiple IDs? Contact us for bulk orders._', 0.5, '[]'],
            ['Nitro ID — 3 Months', '🪪', 'Nitro on a ready account ID — 3 months of full Nitro perks. Best value.\n\n» Fast Delivery\n» Reliable Service\n» Bulk Orders Available\n» Order Assistance Available\n\n_Need multiple IDs? Contact us for bulk orders._', 1.5, '[]'],
            ['Nitro VCC', '💳', 'Virtual card topped up for Nitro purchases. Ask staff for availability.', 8, JSON.stringify([{ label: 'Discord account email', style: 'short', required: true }])],
            ['Nitro Promo', '🎟️', 'Discounted Nitro promo codes — limited stock.', 3, '[]'],
            ['Nitro Deco', '🎨', 'Profile decoration / avatar decoration codes.', 1.5, '[]'],
          ],
        },
        {
          name: 'Gaming',
          emoji: '🎮',
          description: 'Game currencies & top-ups',
          products: [
            ['Robux', '💠', 'Roblox Robux top-up.', 249, JSON.stringify([{ label: 'Roblox Username', style: 'short', required: true }])],
            ['Free Fire', '🔥', 'Free Fire diamonds & bundles.', 199, JSON.stringify([
              { label: 'Player UID', style: 'short', required: true },
              { label: 'Region', style: 'short', required: true },
              { label: 'Package', style: 'short', required: true },
            ])],
            ['Mobile Legends', '⚔️', 'MLBB diamonds top-up.', 219, JSON.stringify([
              { label: 'Player ID', style: 'short', required: true },
              { label: 'Server ID', style: 'short', required: true },
              { label: 'Package', style: 'short', required: true },
            ])],
            ['More Games', '🕹️', 'Top-ups for other games.', 149, '[]'],
          ],
        },
        {
          name: 'Entertainment',
          emoji: '🎵',
          description: 'Streaming subscriptions',
          products: [
            ['Spotify', '🎧', 'Spotify Premium upgrade.', 149, JSON.stringify([{ label: 'Spotify account email', style: 'short', required: true }])],
            ['Netflix', '🍿', 'Netflix premium access.', 249, '[]'],
            ['YouTube', '▶️', 'YouTube Premium upgrade.', 129, '[]'],
            ['More Services', '📺', 'Other streaming services.', 99, '[]'],
          ],
        },
        {
          name: 'Social',
          emoji: '📱',
          description: 'Social media products',
          products: [
            ['Instagram', '📸', 'Instagram growth products.', 179, '[]'],
            ['More Social Products', '🌐', 'Other social media services.', 149, '[]'],
          ],
        },
        {
          name: 'More',
          emoji: '🛍️',
          description: 'Custom products & offers',
          products: [
            ['Custom Products', '✨', 'Ask staff for custom orders.', 0, '[]'],
            ['Special Offers', '🏷️', 'Limited-time special offers.', 99, '[]'],
            ['Coming Soon', '⏳', 'NEW PRODUCT — COMING SOON\nSomething big is on the way. We\'re working on something new, premium & affordable for you.\n\n» High-Quality Service\n» Affordable Pricing\n» Trusted & Reliable\n» More Options\n» Bigger Stock\n» Better Experience\n\n**Status:** Coming Soon • Stay Tuned • More Details Soon™', 0, '[]', 0],
          ],
        },
      ];

      catalog.forEach((cat, i) => {
        const { lastInsertRowid: categoryId } = insertCategory.run(cat.name, cat.emoji, cat.description, i + 1);
        for (const [name, emoji, description, price, questions, stock] of cat.products) {
          insertProduct.run(categoryId, name, emoji, description, price, stock ?? -1, questions);
        }
      });
    }

    if (db.prepare('SELECT COUNT(*) c FROM payment_methods').get().c === 0) {
      const insertMethod = db.prepare(
        'INSERT INTO payment_methods (key, label, emoji, config, instructions, position) VALUES (?, ?, ?, ?, ?, ?)'
      );
      insertMethod.run('upi', 'UPI', '🇮🇳', '{}', 'Pay via UPI and upload the payment screenshot.', 1);
      insertMethod.run('upi2', 'UPI 2', '🇮🇳', '{}', 'Pay via UPI (alternate wallet) and upload the payment screenshot.', 2);
      insertMethod.run('bitcoin', 'Bitcoin', '🟠', '{}', 'Send BTC to the configured wallet address.', 3);
      insertMethod.run('crypto', 'Crypto (USDT)', '🪙', '{}', 'Send USDT to the configured wallet address.', 4);
    }
  });

  seedMethods();
}

module.exports = { seed };
