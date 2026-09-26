'use strict';

const { db } = require('../database/db');

const listCategories = () =>
  db.prepare("SELECT * FROM categories WHERE status = 'active' ORDER BY position, id").all();

const listAllCategories = () =>
  db.prepare('SELECT * FROM categories ORDER BY position, id').all();

const getCategory = (id) => db.prepare('SELECT * FROM categories WHERE id = ?').get(id);

const findCategoryByName = (name) =>
  db.prepare('SELECT * FROM categories WHERE LOWER(name) = LOWER(?)').get(String(name));

const listProducts = (categoryId) =>
  db.prepare("SELECT * FROM products WHERE category_id = ? AND status = 'active' ORDER BY id").all(categoryId);

const getProduct = (id) => db.prepare('SELECT * FROM products WHERE id = ?').get(id);

/** Configured order questions for a product (max 5, safe on bad JSON). */
function questionsOf(product) {
  try {
    const q = JSON.parse(product.questions || '[]');
    return Array.isArray(q) ? q.slice(0, 5) : [];
  } catch {
    return [];
  }
}

/** Build question objects from "!setquestions 5 | Q1 | Q2 ..." input. */
function parseQuestionsInput(labels) {
  return labels
    .filter(Boolean)
    .slice(0, 5)
    .map((label, i) => ({
      id: `q${i}`,
      label: String(label).slice(0, 45),
      style: 'short',
      required: true,
      placeholder: '',
    }));
}

/** Decrease stock by qty; unlimited stock (-1) stays unlimited. */
function decrementStock(productId, qty) {
  db.prepare(
    `UPDATE products
     SET stock = CASE WHEN stock = -1 THEN -1 ELSE MAX(stock - ?, 0) END,
         updated_at = datetime('now')
     WHERE id = ?`
  ).run(qty, productId);
}

// ── Admin CRUD (used by the web dashboard and the !add* / !edit* commands) ───

const CATEGORY_FIELDS = ['name', 'emoji', 'description', 'image_url', 'status', 'position'];
const PRODUCT_FIELDS = [
  'category_id',
  'name',
  'emoji',
  'description',
  'price',
  'stock',
  'minimum_quantity',
  'maximum_quantity',
  'status',
  'image_url',
  'delivery_type',
  'questions',
];

const pick = (fields, allowed) =>
  Object.fromEntries(
    Object.entries(fields || {}).filter(
      ([k, v]) => allowed.includes(k) && v !== undefined && v !== null
    )
  );

function createCategory(fields = {}) {
  const data = pick(fields, CATEGORY_FIELDS);
  const info = db
    .prepare(
      `INSERT INTO categories (name, emoji, description, image_url, status, position)
       VALUES (@name, @emoji, @description, @image_url, @status, @position)`
    )
    .run({
      name: String(data.name || 'New Category').slice(0, 100),
      emoji: data.emoji || '🛍️',
      description: data.description || '',
      image_url: data.image_url || null,
      status: data.status || 'active',
      position: Number.isFinite(Number(data.position)) ? Number(data.position) : 0,
    });
  return getCategory(info.lastInsertRowid);
}

function updateCategory(id, fields = {}) {
  const data = pick(fields, CATEGORY_FIELDS);
  const keys = Object.keys(data);
  if (!keys.length) return getCategory(id);
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(
    `UPDATE categories SET ${sets}, updated_at = datetime('now') WHERE id = @id`
  ).run({ ...data, id: Number(id) });
  return getCategory(id);
}

function deleteCategory(id) {
  return db.prepare('DELETE FROM categories WHERE id = ?').run(Number(id)).changes > 0;
}

function createProduct(fields = {}) {
  const data = pick(fields, PRODUCT_FIELDS);
  const info = db
    .prepare(
      `INSERT INTO products
        (category_id, name, emoji, description, price, stock, minimum_quantity,
         maximum_quantity, status, image_url, delivery_type, questions)
       VALUES
        (@category_id, @name, @emoji, @description, @price, @stock, @minimum_quantity,
         @maximum_quantity, @status, @image_url, @delivery_type, @questions)`
    )
    .run({
      category_id: Number(data.category_id) || null,
      name: String(data.name || 'New Product').slice(0, 120),
      emoji: data.emoji || '🛒',
      description: data.description || '',
      price: Number(data.price) || 0,
      stock: data.stock === undefined ? -1 : Number(data.stock),
      minimum_quantity: Math.max(1, Number(data.minimum_quantity) || 1),
      maximum_quantity: Math.max(1, Number(data.maximum_quantity) || 10),
      status: data.status || 'active',
      image_url: data.image_url || null,
      delivery_type: data.delivery_type || 'manual',
      questions: data.questions || '[]',
    });
  return getProduct(info.lastInsertRowid);
}

function updateProduct(id, fields = {}) {
  const data = pick(fields, PRODUCT_FIELDS);
  const keys = Object.keys(data);
  if (!keys.length) return getProduct(id);
  const num = ['category_id', 'price', 'stock', 'minimum_quantity', 'maximum_quantity'];
  for (const k of num) if (k in data) data[k] = Number(data[k]);
  if ('minimum_quantity' in data) data.minimum_quantity = Math.max(1, data.minimum_quantity || 1);
  if ('maximum_quantity' in data) data.maximum_quantity = Math.max(1, data.maximum_quantity || 10);
  const sets = keys.map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({
    ...data,
    id: Number(id),
  });
  return getProduct(id);
}

function deleteProduct(id) {
  return db.prepare('DELETE FROM products WHERE id = ?').run(Number(id)).changes > 0;
}

module.exports = {
  listCategories,
  listAllCategories,
  getCategory,
  findCategoryByName,
  createCategory,
  updateCategory,
  deleteCategory,
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  questionsOf,
  parseQuestionsInput,
  decrementStock,
};
