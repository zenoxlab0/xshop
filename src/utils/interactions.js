'use strict';

const { MessageFlags } = require('discord.js');
const { e } = require('./embeds');

/** Reply ephemerally (visible only to the interaction user). */
function replyEphemeral(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

const WRONG_USER = `${e('cancelled')} This shopping session belongs to another customer.`;

module.exports = { replyEphemeral, WRONG_USER };
