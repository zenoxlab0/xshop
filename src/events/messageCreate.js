'use strict';

const { Events } = require('discord.js');
const config = require('../config/config');
const { handleBuyTrigger } = require('../shop/panel');
const commands = require('../commands');
const flow = require('../tickets/flow');
const { errorLog } = require('../services/logs');

module.exports = {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      if (message.author.bot || !message.guild) return;

      // Public shop trigger — only inside the configured shop channel.
      if (
        message.channel.id === config.shopChannelId &&
        config.triggers.includes(message.content.trim().toLowerCase())
      ) {
        return await handleBuyTrigger(message);
      }

      // Prefix admin commands.
      if (message.content.startsWith(config.prefix)) {
        return await commands.execute(message);
      }

      // Payment-proof detection inside order tickets.
      if (message.attachments.size > 0) {
        return await flow.onTicketMessage(message);
      }
    } catch (err) {
      await errorLog('messageCreate', err);
    }
  },
};
