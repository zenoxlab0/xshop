'use strict';

/**
 * `!xhelp` — the staff command console.
 *
 * The old version dumped every command as a bare usage string into 6 fields on
 * one screen: 39 rows of `!setpayfield <key> upi_id=…` with no hint of what any
 * of them actually did. This splits it into an overview plus one screen per
 * section, reachable from a select menu, and gives every command a one-line
 * description so staff can find the right one without guessing.
 *
 * Every command registered anywhere still appears — anything not explicitly
 * filed under a section falls into SYSTEM, so a future command can never hide.
 */

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const {
  brand,
  COLORS,
  DOT,
  e,
  eComp,
  heroLines,
  quote,
  lead,
  plain,
  section,
} = require('../utils/embeds');
const { registry } = require('../commands/registry');

/** Section order, icon (UI emoji key) and the commands each one files. */
const SECTIONS = [
  {
    id: 'catalog',
    key: 'stock',
    label: 'Catalog',
    blurb: 'Categories, products, pricing and stock',
    names: [
      'addcategory', 'editcategory', 'deletecategory', 'categories',
      'addproduct', 'editproduct', 'deleteproduct', 'products',
      'setprice', 'setstock', 'setquestions',
    ],
  },
  {
    id: 'payments',
    key: 'card',
    label: 'Payments',
    blurb: 'How customers pay you — UPI, cards, crypto',
    names: [
      'setpayment', 'setpayfield', 'setqr', 'payments', 'delpayment', 'togglepayment',
    ],
  },
  {
    id: 'orders',
    key: 'ticket',
    label: 'Orders & Tickets',
    blurb: 'Run the queue, verify payments, deliver',
    names: ['orders', 'order', 'stats', 'refund', 'close', 'cancel', 'note'],
  },
  {
    id: 'social',
    key: 'heart',
    label: 'Social Proof',
    blurb: 'Channel announcements + the panel’s Vouches / Deals tabs',
    names: ['vouch', 'deal', 'vouchchannel', 'dealchannel'],
  },
  {
    id: 'appearance',
    key: 'sparkle',
    label: 'Appearance',
    blurb: 'Emojis, banners and the shop panel look',
    names: [
      'setemoji', 'resetemoji', 'emojis', 'emojiscan', 'autoemojis',
      'addemoji', 'delemoji', 'setbanner', 'setlogo',
    ],
  },
  {
    id: 'system',
    key: 'more',
    label: 'System',
    blurb: 'Health checks, maintenance and help',
    names: ['maintenance', 'panel', 'buysetup', 'doctor', 'ping', 'help', 'xhelp'],
  },
];

/**
 * One-line purpose per command. Keys are command names; anything missing falls
 * back to its `usage` string so a new command still renders sensibly.
 */
const DESCRIPTIONS = {
  addcategory: 'Create a shop category',
  editcategory: 'Rename, re-emoji or reorder a category',
  deletecategory: 'Remove a category and everything in it',
  categories: 'List every category with its id',
  addproduct: 'Add a product — name, price, description, stock',
  editproduct: 'Change a product\'s price, stock, limits or image',
  deleteproduct: 'Remove a product',
  products: 'List every product in a category',
  setprice: 'Quick price change for one product',
  setstock: 'Set remaining stock, or `unlimited`',
  setquestions: 'Set the questions customers answer at checkout',

  setpayment: 'Create or rename a payment method',
  setpayfield: 'Fill in UPI id, wallet, coin or network',
  setqr: 'Attach a QR image to a payment method',
  payments: 'List payment methods and their config state',
  delpayment: 'Delete a payment method',
  togglepayment: 'Turn a payment method on or off',

  orders: 'Browse the order queue, filter by status',
  order: 'Inspect one order end to end',
  stats: 'Revenue, order counts and top products',
  refund: 'Refund an order and notify the customer',
  close: 'Close the current ticket',
  cancel: 'Cancel an order',
  note: 'Leave a private staff note on an order',

  vouch: 'Post "<player> legit got <product>" — anyone can vouch',
  deal: 'Post a completed-deal announcement (dealer, customer, product)',
  vouchchannel: 'Show or set the channel !vouch posts to',
  dealchannel: 'Show or set the channel deal announcements post to',

  setemoji: 'Bind a UI emoji key to a custom emoji',
  resetemoji: 'Revert one emoji key to its default',
  emojis: 'Show every emoji key and what it points at',
  emojiscan: 'Scan this server\'s emojis for usable keys',
  autoemojis: 'Auto-bind every key by name match',
  addemoji: 'Upload an image as a server emoji',
  delemoji: 'Delete a server emoji',
  setbanner: 'Set (or clear) the shop panel banner image',
  setlogo: 'Set (or clear) the shop panel logo',

  maintenance: 'Pause buying while you restock',
  panel: 'Repost the shop panel in a channel',
  buysetup: 'Open the interactive buy menu here — customers order in one click',
  doctor: 'Live permission & setup health report',
  ping: 'Gateway latency',
  help: 'Customer-facing ordering guide',
  xhelp: 'This console',
};

const SECTIONS_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

/** Commands the viewer is allowed to see, in registry order. */
function visibleCommands(admin) {
  return [...registry.values()].filter((c) => admin || c.level !== 'admin');
}

/** `!cmd` — description (admin commands marked with the crown). */
function commandLine(cmd) {
  const desc = DESCRIPTIONS[cmd.name] || plain(cmd.usage).slice(0, 70);
  const head = `\`${plain(cmd.usage).split(' ')[0] || `!${cmd.name}`}\``;
  return cmd.level === 'admin' ? quote(`${e('crown')} ${head}  ${DOT}  ${desc}`) : quote(`${head}  ${DOT}  ${desc}`);
}

/** Membership test over the section filing, used for counts and leftovers. */
function assignSections() {
  return { byName: (name) => SECTIONS.find((s) => s.names.includes(name)) };
}

function sectionMenu(current) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('help:section')
    // Select labels render as PLAIN TEXT — never put an emoji tag in one.
    .setPlaceholder('Jump to a section…')
    .addOptions(
      [
        {
          value: 'overview',
          label: 'Overview',
          description: 'Back to the section list',
          emoji: eComp('shop'),
        },
        ...SECTIONS.map((s) => ({
          value: s.id,
          label: s.label,
          description: s.blurb,
          emoji: eComp(s.key),
        })),
      ].map((o) => {
        const option = {
          label: plain(o.label).slice(0, 100),
          description: plain(o.description).slice(0, 100),
          default: o.value === current,
          value: o.value,
        };
        // `emoji: ''` would serialise to `emoji: null` and be rejected.
        if (o.emoji) option.emoji = o.emoji;
        return option;
      })
    );
  return new ActionRowBuilder().addComponents(menu);
}

/** Landing screen: what each section holds, plus the nav menu. */
function overviewView(admin) {
  const visible = visibleCommands(admin);
  const { byName } = assignSections();

  const lines = [];
  for (const s of SECTIONS) {
    const count = visible.filter((c) => byName(c.name) === s).length;
    if (!count) continue;
    lines.push(
      quote(lead(e(s.key), `**${s.label}**  ${DOT}  ${count}`)),
      quote(`   ${DOT}  ${plain(s.blurb).slice(0, 100)}`)
    );
  }

  const embed = brand(COLORS.black)
    .setTitle(`${e('staff')}  X SHOP — STAFF CONSOLE`)
    .setDescription(
      [
        ...heroLines('Pick a section below — every command, one line each.'),
        '',
        section('Sections'),
        ...(lines.length ? lines : [quote(`${e('more')} No commands visible.`)]),
        '',
        section('How to use it'),
        quote(`Choose a section in the menu below to see its commands with a short description of each.`),
        quote(`${e('crown')} marks admin-only commands  ${DOT}  unmarked are available to all staff.`),
        quote(`${e('more')} Everything here also works as a **slash command** (staff \`!orders\` is \`/stafforders\`).`),
      ].join('\n')
    );

  return { embeds: [embed], components: [sectionMenu('overview')] };
}

/** One section, with a description next to every command. */
function sectionView(id, admin) {
  const s = SECTIONS_BY_ID.get(id) || SECTIONS_BY_ID.get('system');
  const visible = visibleCommands(admin);
  const { byName } = assignSections();

  const own = visible.filter((c) => byName(c.name) === s);
  // Anything unfiled still shows up — a new command can never go missing.
  const leftover = visible.filter((c) => s.id === 'system' && !byName(c.name));

  const embed = brand(COLORS.violet)
    .setTitle(lead(e(s.key), s.label))
    .setDescription(
      [
        ...heroLines(s.blurb),
        '',
        section(`Commands  ${DOT}  ${own.length}  ${DOT}  \`!prefix\` or slash`),
        ...(own.length
          ? own.map(commandLine).join('\n').split('\n')
          : [quote(`${e('more')} Nothing filed here yet.`)]),
        ...(leftover.length
          ? ['', section(`${e('more')}  Unclassified`), leftover.map(commandLine).join('\n')]
          : []),
        '',
        section('Legend'),
        quote(`${e('crown')} admin only  ${DOT}  unmarked = staff`),
        quote(`\`!\` prefix commands and slash commands are interchangeable.`),
      ].join('\n')
    );

  return { embeds: [embed], components: [sectionMenu(s.id)] };
}

/**
 * Router for the `help:section` select menu. Only staff may drive it, and the
 * reply always replaces the existing message so the console never spams.
 */
async function handleSelect(interaction) {
  const { isStaff, isAdmin } = require('../utils/perms');
  if (!isStaff(interaction.member)) {
    return interaction.reply({
      content: `${e('cancelled')} Only staff can use the command console.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  const id = String((interaction.values && interaction.values[0]) || 'overview');
  const admin = isAdmin(interaction.member);
  const payload = id === 'overview' ? overviewView(admin) : sectionView(id, admin);
  return interaction.update(payload);
}

module.exports = { overviewView, sectionView, handleSelect, SECTIONS, DESCRIPTIONS };
