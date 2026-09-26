'use strict';

const { Events, MessageFlags } = require('discord.js');
const shopHandlers = require('../shop/handlers');
const flow = require('../tickets/flow');
const staff = require('../tickets/staff');
const slash = require('../slash');
const xhelp = require('../commands/xhelp');
const { errorLog } = require('../services/logs');
const { e } = require('../utils/embeds');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        return await slash.handleChatInput(interaction);
      }

      if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const id = interaction.customId;
        if (id.startsWith('shop:') || id.startsWith('bst:')) return await shopHandlers.handleComponent(interaction);
        if (id.startsWith('help:')) return await xhelp.handleSelect(interaction);
        if (id.startsWith('ord:')) return await flow.handleComponent(interaction);
        if (id.startsWith('stf:')) return await staff.handleComponent(interaction);
        if (id.startsWith('ords:')) return await slash.handleOrdersButton(interaction);
        if (id.startsWith('sup:')) return await slash.handleSupportButton(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        const [, kind] = interaction.customId.split(':');
        if (kind === 'ans') return await flow.handleAnswersModal(interaction);
        if (kind === 'qty') return await flow.handleCustomQtyModal(interaction);
        if (kind === 'rej') return await staff.handleRejectModal(interaction);
        if (kind === 'note') return await staff.handleNoteModal(interaction);
      }
    } catch (err) {
      await errorLog('interaction', err);
      const payload = {
        content: `${e('warning')} Something went wrong. Please try again or contact staff.`,
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {
        /* interaction expired */
      }
    }
  },
};
