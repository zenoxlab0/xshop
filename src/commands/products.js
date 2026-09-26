'use strict';

const { brand, COLORS, fmtMoney, fmtStock, e, eMaybe, lead } = require('../utils/embeds');
const products = require('../products/products');
const { db } = require('../database/db');
const { pipeArgs, kvArgs, toNumber, toInt } = require('../utils/parse');
const { updateRow } = require('../utils/dbUpdate');

const FIELD_MAP = {
  name: 'name',
  emoji: 'emoji',
  desc: 'description',
  description: 'description',
  price: 'price',
  stock: 'stock',
  min: 'minimum_quantity',
  max: 'maximum_quantity',
  status: 'status',
  image: 'image_url',
  category: 'category_id',
  delivery: 'delivery_type',
};

module.exports = [
  {
    name: 'addproduct',
    level: 'admin',
    usage: '!addproduct <category id/name> | <name> | <price> | <description> | <emoji> | <stock>',
    run: async (message, rest) => {
      const parts = pipeArgs(rest);
      const [categoryRef, name, priceRaw, description, emoji, stockRaw] = parts;
      if (!categoryRef || !name || priceRaw === undefined) {
        return message.reply(
          'Usage: `!addproduct <category id/name> | <name> | <price> | <description> | <emoji> | <stock (-1 = unlimited)>`'
        );
      }
      const category = /^\d+$/.test(categoryRef)
        ? products.getCategory(Number(categoryRef))
        : products.findCategoryByName(categoryRef);
      if (!category) return message.reply(`${e('warning')} Category **${categoryRef}** not found. See \`!categories\`.`);

      const price = toNumber(priceRaw);
      if (price === null || price < 0) return message.reply(`${e('warning')} Invalid price.`);
      const stock = stockRaw !== undefined ? (toInt(stockRaw) ?? -1) : -1;

      const info = db
        .prepare(
          `INSERT INTO products (category_id, name, emoji, description, price, stock)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(category.id, name.slice(0, 100), emoji || '🛒', description || '', price, stock);
      await message.reply(
        `${e('completed')} Product **${name}** added to ${lead(eMaybe(category.name, category.emoji), `**${category.name}**`)} (id \`${info.lastInsertRowid}\`).`
      );
    },
  },
  {
    name: 'editproduct',
    level: 'admin',
    usage: '!editproduct <id> name=… price=… stock=… min=… max=… desc=… emoji=… status=active|hidden image=…',
    run: async (message, rest) => {
      const { id, values } = kvArgs(rest);
      if (!id) return message.reply(`Usage: \`${module.exports[1].usage}\``);
      if (values.category && !products.getCategory(Number(values.category))) {
        return message.reply(`${e('warning')} Target category not found.`);
      }
      const changes = updateRow('products', Number(id), values, FIELD_MAP);
      if (!changes) return message.reply(`${e('warning')} Nothing updated — check the id and field names.`);
      await message.reply(`${e('completed')} Product \`${id}\` updated.`);
    },
  },
  {
    name: 'deleteproduct',
    level: 'admin',
    usage: '!deleteproduct <id>',
    run: async (message, rest) => {
      const id = toInt(rest.split(' ')[0]);
      if (!id) return message.reply('Usage: `!deleteproduct <id>`');
      const info = db.prepare('DELETE FROM products WHERE id = ?').run(id);
      if (!info.changes) return message.reply(`${e('warning')} Product not found.`);
      await message.reply(`${e('cancelled')} Product \`${id}\` deleted.`);
    },
  },
  {
    name: 'setprice',
    level: 'admin',
    usage: '!setprice <productId> <price>',
    run: async (message, rest) => {
      const [idRaw, priceRaw] = rest.split(/\s+/);
      const id = toInt(idRaw);
      const price = toNumber(priceRaw);
      if (!id || price === null || price < 0) return message.reply('Usage: `!setprice <productId> <price>`');
      db.prepare("UPDATE products SET price = ?, updated_at = datetime('now') WHERE id = ?").run(price, id);
      await message.reply(`${e('completed')} Price of product \`${id}\` set to **${fmtMoney(price)}**.`);
    },
  },
  {
    name: 'setstock',
    level: 'admin',
    usage: '!setstock <productId> <number | unlimited>',
    run: async (message, rest) => {
      const [idRaw, stockRaw] = rest.split(/\s+/);
      const id = toInt(idRaw);
      if (!id || stockRaw === undefined) return message.reply('Usage: `!setstock <productId> <number | unlimited>`');
      const stock = /^(unlimited|-1|∞)$/i.test(stockRaw) ? -1 : toInt(stockRaw);
      if (stock === null) return message.reply(`${e('warning')} Invalid stock value.`);
      db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(stock, id);
      const p = products.getProduct(id);
      await message.reply(`${e('completed')} Stock of **${p ? p.name : id}** set to ${fmtStock({ stock })}.`);
    },
  },
  {
    name: 'setquestions',
    level: 'admin',
    usage: '!setquestions <productId> | <Question 1> | <Question 2> …  (or: !setquestions <productId> clear)',
    run: async (message, rest) => {
      // Accept the documented "!setquestions <id> clear" space form as the
      // pipe form — pipeArgs only splits on "|", so "6 clear" would otherwise
      // fall through to the set-questions path.
      const parts = pipeArgs(rest.replace(/^(\S+)\s+clear$/i, '$1 | clear'));
      const id = toInt(parts[0]);
      if (!id) return message.reply('Usage: `!setquestions <productId> | Q1 | Q2 …`');
      const product = products.getProduct(id);
      if (!product) return message.reply(`${e('warning')} Product not found.`);

      if (parts.length === 2 && /^clear$/i.test(parts[1])) {
        db.prepare("UPDATE products SET questions = '[]', updated_at = datetime('now') WHERE id = ?").run(id);
        return message.reply(`${e('completed')} Questions cleared for **${product.name}**.`);
      }

      const questions = products.parseQuestionsInput(parts.slice(1));
      db.prepare("UPDATE products SET questions = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(questions),
        id
      );
      await message.reply(
        `${e('completed')} **${questions.length}** question(s) set for **${product.name}**:\n${questions
          .map((q, i) => `${i + 1}. ${q.label}`)
          .join('\n')}`
      );
    },
  },
  {
    name: 'products',
    level: 'staff',
    usage: '!products [categoryId]',
    run: async (message, rest) => {
      const categoryId = toInt(rest.split(' ')[0]);
      const all = categoryId
        ? db.prepare('SELECT * FROM products WHERE category_id = ? ORDER BY id').all(categoryId)
        : db.prepare(
            `SELECT p.*, c.name AS category_name, c.emoji AS category_emoji
             FROM products p JOIN categories c ON c.id = p.category_id
             ORDER BY p.category_id, p.id`
          ).all();
      const lines = all.map(
        (p) =>
          lead(
            eMaybe(p.name, p.emoji),
            `**${p.name}** — id \`${p.id}\`${p.category_name ? ` • ${lead(eMaybe(p.category_name, p.category_emoji), p.category_name)}` : ''} • ${fmtMoney(p.price)} • ${fmtStock(p)} • ${p.status === 'active' ? `${e('completed')}` : `${e('cancelled')}`}`
          )
      );
      const embed = brand(COLORS.dark)
        .setTitle(`${e('shop')} PRODUCTS`)
        .setDescription(lines.join('\n') || 'No products yet. Use `!addproduct`.');
      await message.reply({ embeds: [embed] });
    },
  },
];
