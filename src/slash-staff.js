'use strict';

/**
 * Slash versions of every staff/admin prefix command from !xhelp.
 *
 * Each spec declares its slash options plus a `rest` builder that serializes
 * those options into the exact argument string the prefix parser expects
 * (`pipeArgs` / `kvArgs` / space-split). The command then runs through the
 * regular commands/index.execute() path on a Message-compatible adapter, so
 * permission checks, validation and error logging are identical to `!` usage.
 */

const {
  SlashCommandBuilder,
  MessageFlags,
  InteractionContextType,
  Collection,
} = require('discord.js');
const config = require('./config/config');
const { execute } = require('./commands');

// ── option helpers ───────────────────────────────────────────────────────────

/** String option builder: (name, description, required). */
const str = (name, description, required = false) => (o) =>
  o.setName(name).setDescription(description).setRequired(required);

/** Integer option builder. */
const int = (name, description, required = false) => (o) =>
  o.setName(name).setDescription(description).setRequired(required);

/** Number (float, for prices) option builder. */
const num = (name, description, required = false) => (o) =>
  o.setName(name).setDescription(description).setRequired(required);

/** Attachment option builder. */
const img = (name, description, required = false) => (o) =>
  o.setName(name).setDescription(description).setRequired(required);

/** Choice string option builder: choices = [[value, label], …]. */
const choice = (name, description, required, choices) => (o) =>
  o
    .setName(name)
    .setDescription(description)
    .setRequired(required)
    .addChoices(...choices.map(([value, label]) => ({ name: label ?? value, value })));

const STATUS_CHOICES = [
  ['pending', 'Pending'],
  ['awaiting_payment', 'Awaiting payment'],
  ['payment_review', 'Payment review'],
  ['processing', 'Processing'],
  ['completed', 'Completed'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
];

/** `a | b | c` with empty middles preserved positionally. */
const pipe = (parts) => parts.map((p) => p ?? '').join(' | ');

/** `5 name=… price=…` — the kvArgs format. */
const kv = (id, pairs) =>
  [id, ...pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${v}`)].join(' ');

const S = (i, n) => i.options.getString(n);
const I = (i, n) => i.options.getInteger(n);
const N = (i, n) => i.options.getNumber(n);
const B = (i, n) => i.options.getBoolean(n);

// ── command specs ────────────────────────────────────────────────────────────

const SPECS = [
  // categories
  {
    name: 'addcategory',
    desc: 'Add a shop category',
    options: (b) => b
      .addStringOption(str('name', 'Category name', true))
      .addStringOption(str('emoji', 'Category emoji (unicode or <:tag:id>)'))
      .addStringOption(str('description', 'Short description shown in the menu')),
    rest: (i) => pipe([S(i, 'name'), S(i, 'emoji'), S(i, 'description')]),
  },
  {
    name: 'editcategory',
    desc: 'Edit a category (name, emoji, status, …)',
    options: (b) => b
      .addIntegerOption(int('id', 'Category id (!categories)', true))
      .addStringOption(str('name', 'New name'))
      .addStringOption(str('emoji', 'New emoji'))
      .addStringOption(str('desc', 'New description (no spaces — same as !editcategory)'))
      .addStringOption(choice('status', 'Visibility', false, [['active'], ['hidden']]))
      .addIntegerOption(int('position', 'Sort position'))
      .addStringOption(str('image', 'Image URL')),
    rest: (i) => kv(I(i, 'id'), [
      ['name', S(i, 'name')], ['emoji', S(i, 'emoji')], ['desc', S(i, 'desc')],
      ['status', S(i, 'status')], ['position', I(i, 'position')], ['image', S(i, 'image')],
    ]),
  },
  {
    name: 'deletecategory',
    desc: 'Delete a category and all of its products',
    options: (b) => b.addIntegerOption(int('id', 'Category id', true)),
    rest: (i) => `${I(i, 'id')}`,
  },
  {
    name: 'categories',
    desc: 'List all categories with ids and product counts',
    rest: () => '',
  },

  // products
  {
    name: 'addproduct',
    desc: 'Add a product to a category',
    options: (b) => b
      .addStringOption(str('category', 'Category id or name', true))
      .addStringOption(str('name', 'Product name', true))
      .addNumberOption(num('price', 'Price (e.g. 598 or 598.5)', true))
      .addStringOption(str('description', 'Product description'))
      .addStringOption(str('emoji', 'Product emoji (unicode or <:tag:id>)'))
      .addIntegerOption(int('stock', 'Stock count (-1 = unlimited, default)')),
    rest: (i) => pipe([
      S(i, 'category'), S(i, 'name'), `${N(i, 'price')}`, S(i, 'description'),
      S(i, 'emoji'), I(i, 'stock') === null ? '' : I(i, 'stock'),
    ]),
  },
  {
    name: 'editproduct',
    desc: 'Edit a product (price, stock, status, …)',
    options: (b) => b
      .addIntegerOption(int('id', 'Product id (!products)', true))
      .addStringOption(str('name', 'New name'))
      .addNumberOption(num('price', 'New price'))
      .addIntegerOption(int('stock', 'New stock (-1 = unlimited)'))
      .addIntegerOption(int('min', 'Minimum order quantity'))
      .addIntegerOption(int('max', 'Maximum order quantity'))
      .addStringOption(str('desc', 'New description (no spaces — same as !editproduct)'))
      .addStringOption(str('emoji', 'New emoji'))
      .addStringOption(choice('status', 'Visibility', false, [['active'], ['hidden']]))
      .addStringOption(str('image', 'Image URL'))
      .addIntegerOption(int('category', 'Move to category id')),
    rest: (i) => kv(I(i, 'id'), [
      ['name', S(i, 'name')], ['price', N(i, 'price')], ['stock', I(i, 'stock')],
      ['min', I(i, 'min')], ['max', I(i, 'max')], ['desc', S(i, 'desc')],
      ['emoji', S(i, 'emoji')], ['status', S(i, 'status')], ['image', S(i, 'image')],
      ['category', I(i, 'category')],
    ]),
  },
  {
    name: 'deleteproduct',
    desc: 'Delete a product',
    options: (b) => b.addIntegerOption(int('id', 'Product id', true)),
    rest: (i) => `${I(i, 'id')}`,
  },
  {
    name: 'setprice',
    desc: 'Set a product price',
    options: (b) => b
      .addIntegerOption(int('product', 'Product id', true))
      .addNumberOption(num('price', 'New price', true)),
    rest: (i) => `${I(i, 'product')} ${N(i, 'price')}`,
  },
  {
    name: 'setstock',
    desc: 'Set product stock (number or unlimited)',
    options: (b) => b
      .addIntegerOption(int('product', 'Product id', true))
      .addStringOption(str('stock', 'Number, or "unlimited"', true)),
    rest: (i) => `${I(i, 'product')} ${S(i, 'stock')}`,
  },
  {
    name: 'setquestions',
    desc: 'Set the order questions for a product',
    options: (b) => b
      .addIntegerOption(int('product', 'Product id', true))
      .addStringOption(str('questions', 'Questions separated by | (Question 1 | Question 2)'))
      .addBooleanOption((o) => o.setName('clear').setDescription('Remove all questions')),
    rest: (i) => (B(i, 'clear') ? `${I(i, 'product')} clear` : pipe([I(i, 'product'), S(i, 'questions')])),
  },
  {
    name: 'products',
    desc: 'List products (all or one category)',
    options: (b) => b.addIntegerOption(int('category', 'Category id filter')),
    rest: (i) => (I(i, 'category') === null ? '' : `${I(i, 'category')}`),
  },

  // payments
  {
    name: 'setpayment',
    desc: 'Create or update a payment method',
    options: (b) => b
      .addStringOption(str('key', 'Method key, e.g. upi / btc', true))
      .addStringOption(str('label', 'Customer-visible label', true))
      .addStringOption(str('emoji', 'Method emoji')),
    rest: (i) => pipe([S(i, 'key'), S(i, 'label'), S(i, 'emoji')]),
  },
  {
    name: 'setpayfield',
    desc: 'Set payment method fields (upi_id, wallet, …)',
    options: (b) => b
      .addStringOption(str('key', 'Method key', true))
      .addStringOption(str('upi_id', 'UPI id (upi methods)'))
      .addStringOption(str('name', 'Receiver name'))
      .addStringOption(str('wallet', 'Wallet address'))
      .addStringOption(str('coin', 'Coin, e.g. BTC / USDT'))
      .addStringOption(str('network', 'Network, e.g. Bitcoin / TRC20'))
      .addStringOption(str('instructions', 'Extra instructions (no spaces)')),
    rest: (i) => kv(S(i, 'key'), [
      ['upi_id', S(i, 'upi_id')], ['name', S(i, 'name')], ['wallet', S(i, 'wallet')],
      ['coin', S(i, 'coin')], ['network', S(i, 'network')], ['instructions', S(i, 'instructions')],
    ]),
  },
  {
    name: 'setqr',
    desc: 'Upload the QR image for a payment method',
    options: (b) => b
      .addStringOption(str('key', 'Method key', true))
      .addAttachmentOption(img('image', 'QR code image', true)),
    rest: (i) => S(i, 'key'),
  },
  {
    name: 'payments',
    desc: 'List payment methods and their configuration',
    rest: () => '',
  },
  {
    name: 'delpayment',
    desc: 'Delete a payment method',
    options: (b) => b.addStringOption(str('key', 'Method key', true)),
    rest: (i) => S(i, 'key'),
  },
  {
    name: 'togglepayment',
    desc: 'Show/hide a payment method',
    options: (b) => b.addStringOption(str('key', 'Method key', true)),
    rest: (i) => S(i, 'key'),
  },

  // orders & tickets
  {
    name: 'stafforders', // "/orders" is the customer-facing history command
    cmd: 'orders',
    desc: 'List the latest orders (staff view)',
    options: (b) => b.addStringOption(choice('status', 'Filter by status', false, STATUS_CHOICES)),
    rest: (i) => S(i, 'status') ?? '',
  },
  {
    name: 'order',
    desc: 'Show one order with its event history',
    options: (b) => b.addStringOption(str('order_id', 'Order id, e.g. XS-AB12CD', true)),
    rest: (i) => S(i, 'order_id'),
  },
  {
    name: 'refund',
    desc: 'Mark an order as refunded',
    options: (b) => b.addStringOption(str('order_id', 'Order id', true)),
    rest: (i) => S(i, 'order_id'),
  },
  {
    name: 'stats',
    desc: 'Shop statistics: revenue, top products & customers',
    rest: () => '',
  },
  {
    name: 'close',
    desc: 'Close the order ticket you are in',
    rest: () => '',
  },
  {
    name: 'cancel',
    desc: 'Cancel an order',
    options: (b) => b.addStringOption(str('order_id', 'Order id', true)),
    rest: (i) => S(i, 'order_id'),
  },
  {
    name: 'note',
    desc: 'Add a staff note to an order',
    options: (b) => b
      .addStringOption(str('order_id', 'Order id', true))
      .addStringOption(str('text', 'Note text', true)),
    rest: (i) => `${S(i, 'order_id')} ${S(i, 'text')}`,
  },

  // social
  {
    name: 'vouch',
    desc: 'Post a vouch to the vouch channel (anyone can use it)',
    options: (b) => b
      .addUserOption((o) => o.setName('player').setDescription('Player who bought').setRequired(true))
      .addStringOption(str('product', 'Product name', true)),
    rest: (i) => `<@${i.options.getUser('player').id}> ${S(i, 'product')}`,
  },
  {
    name: 'deal',
    desc: 'Post a completed deal to the deals channel',
    options: (b) => b
      .addUserOption((o) => o.setName('customer').setDescription('Customer who bought').setRequired(true))
      .addStringOption(str('product', 'Product name', true)),
    rest: (i) => `<@${i.options.getUser('customer').id}> ${S(i, 'product')}`,
  },
  {
    name: 'vouchchannel',
    desc: 'Show or set the vouch channel',
    options: (b) => b.addChannelOption((o) =>
      o.setName('channel').setDescription('Channel (omit to show current)').addChannelTypes(0)),
    rest: (i) => i.options.getChannel('channel')?.id ?? '',
  },
  {
    name: 'dealchannel',
    desc: 'Show or set the deals channel',
    options: (b) => b.addChannelOption((o) =>
      o.setName('channel').setDescription('Channel (omit to show current)').addChannelTypes(0)),
    rest: (i) => i.options.getChannel('channel')?.id ?? '',
  },

  // system
  {
    name: 'maintenance',
    desc: 'Toggle shop maintenance mode',
    options: (b) => b.addStringOption(choice('mode', 'Mode', true, [['on'], ['off']])),
    rest: (i) => S(i, 'mode'),
  },
  {
    name: 'panel',
    desc: 'Post / refresh the shop panel in a channel',
    options: (b) => b.addChannelOption((o) =>
      o.setName('channel').setDescription('Channel (default: this one)').addChannelTypes(0)),
    rest: (i) => i.options.getChannel('channel')?.id ?? '',
  },
  {
    name: 'xhelp',
    desc: 'Show the staff & admin command reference',
    rest: () => '',
  },
  {
    name: 'ping',
    desc: 'Bot latency check',
    rest: () => '',
  },
  {
    name: 'setbanner',
    desc: 'Set the shop panel banner image',
    options: (b) => b
      .addStringOption(str('url', 'Banner image URL'))
      .addAttachmentOption(img('image', 'Banner image file'))
      .addBooleanOption((o) => o.setName('off').setDescription('Remove the banner')),
    rest: (i) => (B(i, 'off') ? 'off' : S(i, 'url') ?? ''),
  },
  {
    name: 'setlogo',
    desc: 'Set the shop panel logo image',
    options: (b) => b
      .addStringOption(str('url', 'Logo image URL'))
      .addAttachmentOption(img('image', 'Logo image file'))
      .addBooleanOption((o) => o.setName('off').setDescription('Remove the logo')),
    rest: (i) => (B(i, 'off') ? 'off' : S(i, 'url') ?? ''),
  },

  // emojis
  {
    name: 'setemoji',
    desc: 'Override a UI emoji key',
    options: (b) => b
      .addStringOption(str('key', 'UI key, e.g. cart / money (see /emojis)', true))
      .addStringOption(str('emoji', 'Emoji, <:name:id>, :name: or #index from /emojiscan', true)),
    rest: (i) => `${S(i, 'key')} ${S(i, 'emoji')}`,
  },
  {
    name: 'resetemoji',
    desc: 'Reset a UI emoji key to its default',
    options: (b) => b.addStringOption(str('key', 'UI key (see /emojis)', true)),
    rest: (i) => S(i, 'key'),
  },
  {
    name: 'emojis',
    desc: 'Emoji studio: current keys, values & sources',
    rest: () => '',
  },
  {
    name: 'emojiscan',
    desc: 'Scan this server\'s custom emojis',
    rest: () => '',
  },
  {
    name: 'autoemojis',
    desc: 'Re-scan server emojis onto UI keys',
    rest: () => '',
  },
  {
    name: 'addemoji',
    desc: 'Upload a custom emoji to this server',
    options: (b) => b
      .addStringOption(str('name', 'Emoji name (2-32 chars, letters/digits/_)', true))
      .addStringOption(str('url', 'Image URL (or use the image option)'))
      .addAttachmentOption(img('image', 'Image file (≤256 KB)')),
    rest: (i) => `${S(i, 'name')}${S(i, 'url') ? ` ${S(i, 'url')}` : ''}`,
  },
  {
    name: 'delemoji',
    desc: 'Delete a custom emoji from this server',
    options: (b) => b.addStringOption(str('name', 'Emoji name', true)),
    rest: (i) => S(i, 'name'),
  },
];

// ── Message adapter ──────────────────────────────────────────────────────────

/** Wrap payloads so staff command output stays ephemeral (no channel spam). */
function ephemeralWrap(payload) {
  if (typeof payload === 'string') return { content: payload, flags: MessageFlags.Ephemeral };
  return { ...payload, flags: payload.flags ?? MessageFlags.Ephemeral };
}

/** Attachment options the user actually provided, as a Message-like Collection. */
function collectAttachments(interaction) {
  const attachments = new Collection();
  for (const option of interaction.options.data) {
    if (option.attachment) attachments.set(option.attachment.id, option.attachment);
  }
  return attachments;
}

/**
 * A stand-in Message with exactly the surface the prefix commands use:
 * reply/edit/delete, member, author, channel, guild, client, attachments.
 */
function fakeMessage(interaction) {
  let first = true;
  const replyResult = () => ({
    edit: async (payload) => interaction.editReply(payload),
    delete: async () => interaction.deleteReply().catch(() => {}),
  });
  return {
    client: interaction.client,
    guild: interaction.guild,
    channel: interaction.channel,
    member: interaction.member,
    author: interaction.user,
    attachments: collectAttachments(interaction),
    reference: null,
    reply: async (payload) => {
      if (first) {
        first = false;
        await interaction.reply(ephemeralWrap(payload));
      } else {
        await interaction.followUp(ephemeralWrap(payload));
      }
      return replyResult();
    },
  };
}

// ── registration & routing ───────────────────────────────────────────────────

const staffSlashBody = SPECS.map((spec) => {
  const builder = new SlashCommandBuilder()
    .setName(spec.name)
    .setDescription(spec.desc)
    .setContexts(InteractionContextType.Guild); // guild commands only
  if (spec.options) spec.options(builder);
  return builder.toJSON();
});

/** Run a staff slash command through the prefix pipeline. False = unknown. */
async function runStaffSlash(interaction) {
  const spec = SPECS.find((s) => s.name === interaction.commandName);
  if (!spec) return false;
  const rest = spec.rest(interaction);
  const content = `${config.prefix}${spec.cmd ?? spec.name}${rest ? ` ${rest}` : ''}`;
  await execute({ ...fakeMessage(interaction), content });
  return true;
}

module.exports = { staffSlashBody, runStaffSlash };
