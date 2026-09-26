'use strict';

const crypto = require('crypto');

/**
 * Generate a unique order id such as XS-7A42F9.
 * Order ids are never reused — uniqueness is checked against the orders table.
 */
function generateOrderId(db) {
  for (let i = 0; i < 100; i++) {
    const id = `XS-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const exists = db.prepare('SELECT 1 FROM orders WHERE order_id = ?').get(id);
    if (!exists) return id;
  }
  throw new Error('Unable to generate a unique order id');
}

/** Sanitize free text into a safe channel-name slug. */
function slugify(text, max = 30) {
  const slug = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return slug || 'item';
}

module.exports = { generateOrderId, slugify };
