'use strict';

const fs = require('fs');
const path = require('path');
const { brand, COLORS, e, eMaybe, lead } = require('../utils/embeds');
const methods = require('../payments/methods');
const config = require('../config/config');
const { pipeArgs, kvArgs } = require('../utils/parse');

module.exports = [
  {
    name: 'setpayment',
    level: 'admin',
    usage: '!setpayment <key> | <label> | <emoji>',
    run: async (message, rest) => {
      const [key, label, emoji] = pipeArgs(rest);
      if (!key || !label) return message.reply('Usage: `!setpayment <key> | <label> | <emoji>`');
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      methods.upsert(cleanKey, label, emoji);
      await message.reply(
        `${e('completed')} Payment method **${label}** saved (\`${cleanKey}\`). Configure it with:\n` +
          (cleanKey === 'upi'
            ? '`!setpayfield upi upi_id=yourname@upi name=Your Name`'
            : `\`!setpayfield ${cleanKey} coin=BTC network=Bitcoin wallet=...\``)
      );
    },
  },
  {
    name: 'setpayfield',
    level: 'admin',
    usage: '!setpayfield <key> upi_id=… name=… wallet=… coin=… network=… instructions=…',
    run: async (message, rest) => {
      const spaceIdx = rest.indexOf(' ');
      const key = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).trim().toLowerCase();
      const fieldString = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
      const method = methods.get(key);
      if (!method) return message.reply(`${e('warning')} Payment method \`${key}\` not found. See \`!payments\`.`);

      // kvArgs expects "<id> k=v …"; the key is passed as the id and ignored.
      const { values } = kvArgs(`${method.key} ${fieldString}`);
      const configFields = {};
      let instructions;
      for (const [k, v] of Object.entries(values)) {
        if (k === 'instructions') instructions = v;
        else configFields[k] = v;
      }

      if (!Object.keys(configFields).length && instructions === undefined) {
        return message.reply(lead(e('warning'), 'Provide at least one `field=value` pair.'));
      }
      if (Object.keys(configFields).length) methods.setFields(method.key, configFields);
      if (instructions !== undefined) dbSetInstructions(method.key, instructions);
      await message.reply(`${e('completed')} Payment method **${method.label}** updated. See \`!payments\`.`);
    },
  },
  {
    name: 'setqr',
    level: 'admin',
    usage: '!setqr <key>  (attach the QR image to this message)',
    run: async (message, rest) => {
      const key = rest.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!key) return message.reply('Usage: `!setqr <key>` with the QR image attached.');
      const attachment = message.attachments.find(
        (a) => a.contentType && a.contentType.startsWith('image/')
      );
      if (!attachment) return message.reply(`${e('warning')} Attach the QR image to this command message.`);

      const res = await fetch(attachment.url);
      if (!res.ok) return message.reply(`${e('warning')} Failed to download the image.`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const file = path.join(config.qrDir, `${key}.png`);
      fs.writeFileSync(file, buffer);
      await message.reply(`${e('completed')} QR code saved for \`${key}\`. It will be attached to payment pages.`);
    },
  },
  {
    name: 'payments',
    level: 'staff',
    usage: '!payments',
    run: async (message) => {
      const all = methods.listAll();
      const lines = all.map((m) => {
        const cfg = methods.cfg(m);
        const fields = Object.entries(cfg)
          .map(([k, v]) => `${k}=\`${String(v).slice(0, 24)}\``)
          .join(' ');
        return lead(
          eMaybe(m.label, m.emoji),
          `**${m.label}** — \`${m.key}\` • ${
            methods.isConfigured(m) ? `${e('completed')} configured` : `${e('cancelled')} not configured`
          } • ${m.status === 'active' ? 'visible' : 'hidden'}${fields ? `\n   └ ${fields}` : ''}`
        );
      });
      const embed = brand(COLORS.dark)
        .setTitle(`${e('card')} PAYMENT METHODS`)
        .setDescription(lines.join('\n') || 'No payment methods yet. Use `!setpayment`.');
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'delpayment',
    level: 'admin',
    usage: '!delpayment <key>',
    run: async (message, rest) => {
      const key = rest.trim().toLowerCase();
      const method = methods.get(key);
      if (!method) return message.reply(`${e('warning')} Payment method not found.`);
      methods.remove(key);
      await message.reply(`${e('cancelled')} Payment method **${method.label}** removed.`);
    },
  },
  {
    name: 'togglepayment',
    level: 'admin',
    usage: '!togglepayment <key>',
    run: async (message, rest) => {
      const key = rest.trim().toLowerCase();
      const method = methods.get(key);
      if (!method) return message.reply(`${e('warning')} Payment method not found.`);
      const next = method.status === 'active' ? 'hidden' : 'active';
      methods.setStatus(key, next);
      await message.reply(`${e('completed')} **${method.label}** is now **${next}**.`);
    },
  },
];

function dbSetInstructions(key, instructions) {
  const { db } = require('../database/db');
  db.prepare('UPDATE payment_methods SET instructions = ? WHERE key = ?').run(instructions, key);
}
