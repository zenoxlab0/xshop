'use strict';

const config = require('../config/config');
const { isStaff, isAdmin } = require('../utils/perms');
const { errorLog } = require('../services/logs');
const { e } = require('../utils/embeds');
const { registry } = require('./registry');

function register(modules) {
  for (const commands of modules) {
    for (const cmd of commands) registry.set(cmd.name, cmd);
  }
}

register([
  require('./categories'),
  require('./products'),
  require('./payments'),
  require('./orders'),
  require('./tickets'),
  require('./system'),
  require('./emojis'),
  require('./social'),
]);

async function execute(message) {
  const content = message.content.slice(config.prefix.length).trim();
  const spaceIdx = content.indexOf(' ');
  const name = (spaceIdx === -1 ? content : content.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim();

  const cmd = registry.get(name);
  if (!cmd) return;

  // level 'public' is usable by everyone; otherwise staff/admin check applies.
  const member = message.member;
  const allowed =
    cmd.level === 'public' ? true : cmd.level === 'admin' ? isAdmin(member) : isStaff(member);
  if (!allowed) {
    const m = await message.reply(`${e('cancelled')} You do not have permission to use this command.`);
    setTimeout(() => m.delete().catch(() => {}), 5000);
    return;
  }

  try {
    await cmd.run(message, rest);
  } catch (err) {
    await errorLog(`command !${name}`, err);
    await message.reply(`${e('warning')} Command failed — details were sent to the error log.`);
  }
}

module.exports = { execute, registry };
