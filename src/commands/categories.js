'use strict';

const { brand, COLORS, e, eMaybe, lead } = require('../utils/embeds');
const products = require('../products/products');
const { db } = require('../database/db');
const { pipeArgs, kvArgs, toInt } = require('../utils/parse');
const { updateRow } = require('../utils/dbUpdate');

const FIELD_MAP = {
  name: 'name',
  emoji: 'emoji',
  desc: 'description',
  description: 'description',
  status: 'status',
  position: 'position',
  image: 'image_url',
};

module.exports = [
  {
    name: 'addcategory',
    level: 'admin',
    usage: '!addcategory <name> | <emoji> | <description>',
    run: async (message, rest) => {
      const [name, emoji, description] = pipeArgs(rest);
      if (!name) return message.reply(`Usage: \`!addcategory <name> | <emoji> | <description>\``);
      const pos = (db.prepare('SELECT MAX(position) p FROM categories').get().p ?? 0) + 1;
      const info = db
        .prepare('INSERT INTO categories (name, emoji, description, position) VALUES (?, ?, ?, ?)')
        .run(name.slice(0, 100), emoji || '🛍️', description || '', pos);
      await message.reply(
        `${e('completed')} Category **${name}** added (id \`${info.lastInsertRowid}\`). Type \`buy\` in the shop channel to refresh the panel.`
      );
    },
  },
  {
    name: 'editcategory',
    level: 'admin',
    usage: '!editcategory <id> name=… emoji=… desc=… status=active|hidden position=… image=…',
    run: async (message, rest) => {
      const { id, values } = kvArgs(rest);
      if (!id) return message.reply(`Usage: \`${module.exports[1].usage}\``);
      const changes = updateRow('categories', Number(id), values, FIELD_MAP);
      if (!changes) return message.reply(`${e('warning')} Nothing updated — check the id and field names.`);
      await message.reply(`${e('completed')} Category \`${id}\` updated.`);
    },
  },
  {
    name: 'deletecategory',
    level: 'admin',
    usage: '!deletecategory <id>',
    run: async (message, rest) => {
      const id = toInt(rest.split(' ')[0]);
      if (!id) return message.reply('Usage: `!deletecategory <id>`');
      const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
      if (!info.changes) return message.reply(`${e('warning')} Category not found.`);
      await message.reply(`${e('cancelled')} Category \`${id}\` deleted (and all of its products).`);
    },
  },
  {
    name: 'categories',
    level: 'staff',
    usage: '!categories',
    run: async (message) => {
      const all = products.listAllCategories();
      const count = db.prepare('SELECT category_id, COUNT(*) c FROM products GROUP BY category_id').all();
      const counts = Object.fromEntries(count.map((r) => [r.category_id, r.c]));
      const lines = all.map(
        (c) =>
          lead(eMaybe(c.name, c.emoji), `**${c.name}** — id \`${c.id}\` • ${counts[c.id] || 0} products • ${
            c.status === 'active' ? `${e('completed')} active` : `${e('cancelled')} hidden`
          }`)
      );
      const embed = brand(COLORS.dark)
        .setTitle(`${e('more')} CATEGORIES`)
        .setDescription(lines.join('\n') || 'No categories yet. Use `!addcategory`.');
      await message.reply({ embeds: [embed] });
    },
  },
];
