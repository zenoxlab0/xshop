'use strict';

const { EmbedBuilder } = require('discord.js');
const config = require('../config/config');
const { e, quote, section, DOT } = require('../utils/embeds');

let client = null;

function setClient(c) {
  client = c;
}

/** Accessor for modules that need the Discord client outside event handlers. */
function getClient() {
  return client;
}

async function sendLog(kind, embed) {
  const channelId = config.logs[kind];
  if (!client || !channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error(`[X SHOP] Failed to send ${kind} log: ${err.message}`);
  }
}

const orderLog = (embed) => sendLog('orders', embed);
const paymentLog = (embed) => sendLog('payments', embed);
const staffLog = (embed) => sendLog('staff', embed);

async function errorLog(context, err) {
  console.error(`[X SHOP] ${context}:`, err);
  // Persist for the web dashboard (bounded so the table can never grow forever).
  try {
    const { db } = require('../database/db');
    db.prepare('INSERT INTO error_log (context, message) VALUES (?, ?)').run(
      String(context).slice(0, 120),
      String(err?.stack || err).slice(0, 2000)
    );
    db.prepare('DELETE FROM error_log WHERE id <= (SELECT MAX(id) - 500 FROM error_log)').run();
  } catch {
    /* logging must never throw */
  }
  if (!client || !config.logs.errors) return;
  try {
    const channel = await client.channels.fetch(config.logs.errors);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setColor(0xef4444)
      .setTitle(`${e('cancelled')} BOT ERROR`)
      .setDescription(
        [
          quote(`Context ${DOT} **${context}**`),
          '',
          section('Details'),
          '```',
          String(err?.stack || err).slice(0, 900),
          '```',
        ].join('\n')
      )
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } catch {
    /* never throw from the error logger */
  }
}

module.exports = { setClient, getClient, sendLog, orderLog, paymentLog, staffLog, errorLog };
