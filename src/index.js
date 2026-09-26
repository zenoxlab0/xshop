'use strict';

const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config/config');
const { seed } = require('./database/seed');
const { errorLog } = require('./services/logs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const events = [
  require('./events/ready'),
  require('./events/messageCreate'),
  require('./events/interactionCreate'),
];

for (const event of events) {
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

process.on('unhandledRejection', (err) => errorLog('unhandledRejection', err));
process.on('uncaughtException', (err) => errorLog('uncaughtException', err));

seed();

client.login(config.token).catch((err) => {
  console.error('[X SHOP] Login failed:', err.message);
  process.exit(1);
});
