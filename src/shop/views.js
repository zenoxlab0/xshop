'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const {
  brand,
  COLORS,
  fmtMoney,
  stockBadge,
  DOT,
  e,
  eMaybe,
  eComp,
  setCompEmoji,
  heroLines,
  quote,
  lead,
  plain,
  section,
  bannerUrl,
  logoUrl,
} = require('../utils/embeds');

/*
 * X SHOP storefront UI — black / obsidian, premium hierarchy.
 *
 * Information architecture (the whole point of this refresh):
 *   panel      → what categories exist          (one line each)
 *   category   → what you can buy + how much    (name + price, NOTHING else)
 *   product    → every detail: description, stock, limits, delivery
 *   tabs       → Shop / Vouches / Deals, switched with buttons on the panel;
 *                vouches and deals are real receipts from the social_proof
 *                table (src/services/socialProof.js)
 *
 * Layout rule: everything stacks LINE WISE, top to bottom. No inline fields,
 * no side-by-side columns — meta rows are grey `>` quote lines, primary rows
 * are plain bold lines. Emoji come from the uploaded pack only; Discord-default
 * emoji are never rendered (they are replaced with a pack emoji or dropped).
 *
 * Every custom id, handler and the whole purchase flow stay untouched.
 */

/** Bold price used by the category list. */
const PRICE_STYLE = (amount) => `**${fmtMoney(amount)}**`;

/** `Sold out` / `3 left` / `In stock` — availability text for a list line. */
function availability(product) {
  if (!product || product.stock === 0) return `${e('cancelled')} Sold out`;
  if (product.stock === -1) return `${e('completed')} In stock`;
  if (product.stock <= 5) return `${e('pending')} ${product.stock} left`;
  return `${e('completed')} In stock`;
}

/** How much the customer will be asked during checkout — surfaced up front. */
function questionsLabel(product) {
  let n = 0;
  try {
    const q = JSON.parse(product.questions || '[]');
    n = Array.isArray(q) ? q.length : 0;
  } catch {
    n = 0;
  }
  return n ? `${n} asked at checkout` : 'None — just pay';
}

// ── Panel ──────────────────────────────────────────────────────────────────

/**
 * Panel component-id prefix. The storefront has two panel flavours:
 *   shop: — the classic `buy` panel: category → product page → Buy button
 *   bst:  — the `!buysetup` panel: category → ticket opens, product picked inside
 * The embed is identical; only the component ids (hence the click behaviour)
 * differ, so both panels can live in the guild at the same time.
 */
const panelPrefix = (ticketMode) => (ticketMode ? 'bst' : 'shop');

function shopPanel(categories, ticketMode = false) {
  const p = panelPrefix(ticketMode);
  const list = categories
    .slice(0, 12)
    .map((c) => {
      const desc = plain(c.description).replace(/\s+/g, ' ').slice(0, 60).trim();
      return quote(lead(eMaybe(c.name, c.emoji), `**${plain(c.name)}**`) + (desc ? `  ${DOT}  ${desc}` : ''));
    })
    .join('\n');

  const embed = brand(COLORS.black)
    .setTitle(`${e('shop')}  X SHOP STORE`)
    .setDescription(
      [
        ...heroLines(ticketMode ? 'Pick a category — your private order ticket opens instantly.' : 'Browse the catalog and open a private order in seconds.'),
        '',
        section('Why X SHOP'),
        quote(`${e('diamond')} Instant delivery`),
        quote(`${e('card')} Secure payment`),
        quote(`${e('staff')} Live support`),
        '',
        section('Categories'),
        list || quote(`${e('more')} No categories available yet.`),
        '',
        quote(`${e('sparkle')} ${ticketMode ? 'Choose a category above to open your ticket.' : 'Pick a category to see what is inside.'}`),
      ].join('\n')
    )
    .setTimestamp();

  const banner = bannerUrl();
  if (banner) embed.setImage(banner);
  const logo = logoUrl();
  if (logo) embed.setThumbnail(logo);

  const components = [...categoryRows(categories, ticketMode), tabRow('shop', ticketMode)];
  if (ticketMode) {
    // !buysetup flavour — impatient customers skip the category menu entirely.
    components.splice(
      1,
      0,
      new ActionRowBuilder().addComponents(
        setCompEmoji(
          new ButtonBuilder().setCustomId('bst:buynow').setLabel('Buy Now').setStyle(ButtonStyle.Success),
          eComp('cart')
        )
      )
    );
  }
  return { embeds: [embed], components };
}

// ── Panel tabs: Shop / Vouches / Deals ─────────────────────────────────────

/**
 * The panel's tab switcher. Three buttons, one per tab; the active tab is
 * highlighted with Primary style so customers can always see where they are.
 * The tab screens edit the panel message in place, so the stored panel id
 * (`panel:<channelId>`) keeps pointing at the same message.
 */
function tabRow(active = 'shop', ticketMode = false) {
  const tab = (key, label, emojiKey) => {
    const button = new ButtonBuilder()
      .setCustomId(`${panelPrefix(ticketMode)}:tab:${key}`)
      .setLabel(label)
      .setStyle(active === key ? ButtonStyle.Primary : ButtonStyle.Secondary);
    return setCompEmoji(button, eComp(emojiKey));
  };
  return new ActionRowBuilder().addComponents(
    tab('shop', 'Shop', 'shop'),
    tab('vouch', 'Vouches', 'star'),
    tab('deals', 'Deals', 'fire')
  );
}

/** `<t:epoch:R>` live-relative timestamp, or '' when there is no valid time. */
function agoLine(epoch) {
  return Number.isFinite(epoch) && epoch > 0 ? `<t:${epoch}:R>` : '';
}

/**
 * The Vouches tab — trust stats on top, newest receipts below, everything
 * stacked line wise as grey quote rows (same layout rule as the rest of the
 * storefront). Pure builder: handlers pass `stats` and the receipt rows in.
 */
function vouchesTab(stats, vouches, ticketMode = false) {
  const top = (stats.top || [])[0];
  const lines = (vouches || []).map((v) =>
    quote(
      `${e('completed')}  <@${v.target_id}>  ${DOT}  **${plain(v.product)}**  ${DOT}  ${agoLine(v.epoch)}`
    )
  );

  const embed = brand(COLORS.black)
    .setTitle(lead(e('star'), 'X SHOP VOUCHES'))
    .setDescription(
      [
        ...heroLines('Real customers, real receipts — staff-confirmed purchases.'),
        '',
        section('Trust stats'),
        quote(`${e('star')} Total vouches  ${DOT}  **${stats.total ?? 0}**`),
        quote(`${e('completed')} This week  ${DOT}  **${stats.week ?? 0}**`),
        top
          ? quote(`${e('crown')} Most vouched  ${DOT}  <@${top.target_id}> (**${top.n}**)`)
          : quote(`${e('crown')} Most vouched  ${DOT}  —`),
        '',
        section('Latest vouches'),
        ...(lines.length
          ? lines
          : [quote(`${e('more')} No vouches yet — staff post them with \`!vouch @player <product>\`.`)]),
        '',
        quote(`${e('heart')} Every vouch is posted by staff — X SHOP stays trusted.`),
      ].join('\n')
    )
    .setTimestamp();

  const banner = bannerUrl();
  if (banner) embed.setImage(banner);
  const logo = logoUrl();
  if (logo) embed.setThumbnail(logo);

  return { embeds: [embed], components: [tabRow('vouch', ticketMode)] };
}

/** The Deals tab — same layout as the Vouches tab, for completed trades. */
function dealsTab(stats, deals, ticketMode = false) {
  const lines = (deals || []).map((d) =>
    quote(
      `${e('fire')}  <@${d.target_id}>  ${DOT}  **${plain(d.product)}**  ${DOT}  dealer <@${d.actor_id}>  ${DOT}  ${agoLine(d.epoch)}`
    )
  );

  const embed = brand(COLORS.black)
    .setTitle(lead(e('fire'), 'X SHOP DEALS'))
    .setDescription(
      [
        ...heroLines('Completed trades — sealed, verified and counted.'),
        '',
        section('Deal stats'),
        quote(`${e('fire')} Total deals  ${DOT}  **${stats.total ?? 0}**`),
        quote(`${e('completed')} This week  ${DOT}  **${stats.week ?? 0}**`),
        stats.latestEpoch
          ? quote(`${e('review')} Latest deal  ${DOT}  ${agoLine(stats.latestEpoch)}`)
          : quote(`${e('review')} Latest deal  ${DOT}  —`),
        '',
        section('Latest deals'),
        ...(lines.length
          ? lines
          : [quote(`${e('more')} No deals yet — staff seal them with \`!deal @customer <product>\`.`)]),
        '',
        quote(`${e('heart')} Thank you for trading with X SHOP.`),
      ].join('\n')
    )
    .setTimestamp();

  const banner = bannerUrl();
  if (banner) embed.setImage(banner);
  const logo = logoUrl();
  if (logo) embed.setThumbnail(logo);

  return { embeds: [embed], components: [tabRow('deals', ticketMode)] };
}

function categoryRows(categories, ticketMode = false) {
  const rows = [];
  if (categories.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${panelPrefix(ticketMode)}:cat`)
      // Placeholders, labels and descriptions are PLAIN TEXT in Discord — a
      // custom-emoji tag would be rendered literally, so they go through plain().
      .setPlaceholder('Choose a category…')
      .addOptions(
        categories.slice(0, 25).map((c) => {
          const emoji = eComp(c.name, c.emoji);
          const option = {
            label: plain(c.name).slice(0, 100) || 'Category',
            value: String(c.id),
            description: plain(c.description || 'Browse products').slice(0, 100),
          };
          // Never emit an empty emoji key — `emoji: ''` serialises to
          // `emoji: null`, which the API rejects.
          if (emoji) option.emoji = emoji;
          return option;
        })
      );
    rows.push(new ActionRowBuilder().addComponents(menu));
  }
  return rows;
}

function categoryRow(categories, ticketMode = false) {
  return categoryRows(categories, ticketMode)[0] || new ActionRowBuilder();
}

// ── Category: one line per product ────────────────────────────────────────

/**
 * The category screen. Deliberately thin: one line per product — name, price,
 * availability. Stock, description, order limits and delivery mode all live on
 * the product page, which is where a customer actually needs them.
 *
 * Products stack line wise as grey quote lines instead of inline fields, so
 * the list reads top to bottom and never wraps into a ragged grid.
 */
function categoryMenu(category, products) {
  const shown = products.slice(0, 12);

  const lines = shown.map((p) =>
    quote(
      `${lead(eMaybe(p.name, p.emoji), `**${plain(p.name).slice(0, 80) || 'Product'}**`)}  ` +
        `${DOT}  ${PRICE_STYLE(p.price)}  ${DOT}  ${availability(p)}`
    )
  );
  if (products.length > shown.length) {
    lines.push(quote(`${e('more')} ${products.length - shown.length} more in the menu below.`));
  }

  const embed = brand(COLORS.dark)
    .setTitle(lead(eMaybe(category.name, category.emoji), category.name))
    .setDescription(
      [
        ...heroLines(category.description || 'Pick a product to see the full details.'),
        '',
        section(`Products  ${DOT}  ${products.length} available`),
        ...(lines.length ? lines : [quote(`${e('more')} Nothing here yet — no products in this category.`)]),
        '',
        quote(`${e('arrow')} Description, stock, quantity limits and delivery live on the product page.`),
      ].join('\n')
    );

  const available = products.filter((p) => p.stock !== 0);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('shop:prod')
    .setPlaceholder('Choose a product…');

  if (available.length) {
    menu.addOptions(
      available.slice(0, 25).map((p) => {
        const emoji = eComp(p.name, p.emoji);
        const option = {
          label: plain(p.name).slice(0, 100) || 'Product',
          value: String(p.id),
          description: plain(`${fmtMoney(p.price)} ${DOT} ${p.stock === -1 ? 'In stock' : `${p.stock} left`}`).slice(
            0,
            100
          ),
        };
        if (emoji) option.emoji = emoji;
        return option;
      })
    );
  } else {
    const emptyEmoji = eComp('cancelled');
    const option = { label: 'No products available', value: 'none' };
    if (emptyEmoji) option.emoji = emptyEmoji;
    menu.addOptions(option).setDisabled(true);
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        setCompEmoji(
          new ButtonBuilder()
            .setCustomId('shop:back:cats')
            .setLabel('Back to categories')
            .setStyle(ButtonStyle.Secondary),
          eComp('shop')
        )
      ),
    ],
  };
}

/**
 * First screen inside a category ticket — the customer picks WHICH product
 * they want here instead of on the public panel. Selecting one creates the
 * order and drops them straight into the quantity stepper.
 */
function pickProductView(category, products, userId) {
  const lines = products
    .slice(0, 12)
    .map((p) =>
      quote(
        `${lead(eMaybe(p.name, p.emoji), `**${plain(p.name).slice(0, 80) || 'Product'}**`)}  ` +
          `${DOT}  ${PRICE_STYLE(p.price)}  ${DOT}  ${availability(p)}`
      )
    );
  if (products.length > lines.length) {
    lines.push(quote(`${e('more')} ${products.length - lines.length} more in the menu below.`));
  }

  const embed = brand(COLORS.dark)
    .setTitle(lead(eMaybe(category.name, category.emoji), `${category.name} — Choose Your Product`))
    .setDescription(
      [
        ...heroLines(`Your private <@${userId}> order ticket is open.`),
        '',
        section(`Products  ${DOT}  ${products.length} available`),
        ...(lines.length ? lines : [quote(`${e('more')} Nothing here yet — no products in this category.`)]),
        '',
        section(`${e('more')} What happens next`),
        quote(`${e('order')} Pick a product from the menu below.`),
        quote(`${e('stock')} Then set the quantity and pay — all right here.`),
      ].join('\n')
    );

  const available = products.filter((p) => p.stock !== 0);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`ord:pick:${category.id}`)
    .setPlaceholder('Choose a product…');

  if (available.length) {
    menu.addOptions(
      available.slice(0, 25).map((p) => {
        const emoji = eComp(p.name, p.emoji);
        const option = {
          label: plain(p.name).slice(0, 100) || 'Product',
          value: String(p.id),
          description: plain(`${fmtMoney(p.price)} ${DOT} ${p.stock === -1 ? 'In stock' : `${p.stock} left`}`).slice(
            0,
            100
          ),
        };
        if (emoji) option.emoji = emoji;
        return option;
      })
    );
  } else {
    const emptyEmoji = eComp('cancelled');
    const option = { label: 'No products available', value: 'none' };
    if (emptyEmoji) option.emoji = emptyEmoji;
    menu.addOptions(option).setDisabled(true);
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        setCompEmoji(
          new ButtonBuilder()
            .setCustomId(`ord:leave:${userId}`)
            .setLabel('Leave')
            .setStyle(ButtonStyle.Danger),
          eComp('cancelled')
        )
      ),
    ],
  };
}

/**
 * First screen of a Buy Now ticket — the customer clicked the panel's Buy Now
 * button without choosing a category, so this menu lists every active category
 * first. Picking one swaps in the pickProductView for that category.
 */
function buyNowMenuView(categories, userId) {
  const lines = categories
    .slice(0, 12)
    .map((c) => {
      const desc = plain(c.description).replace(/\s+/g, ' ').slice(0, 60).trim();
      return quote(lead(eMaybe(c.name, c.emoji), `**${plain(c.name)}**`) + (desc ? `  ${DOT}  ${desc}` : ''));
    });
  if (categories.length > lines.length) {
    lines.push(quote(`${e('more')} ${categories.length - lines.length} more in the menu below.`));
  }

  const embed = brand(COLORS.dark)
    .setTitle(`${e('ticket')} Your Order Ticket — Pick a Category`)
    .setDescription(
      [
        ...heroLines(`Welcome <@${userId}> — your private order ticket is open.`),
        '',
        section('Categories'),
        ...(lines.length ? lines : [quote(`${e('more')} No categories available yet.`)]),
        '',
        section(`${e('more')} What happens next`),
        quote(`${e('cart')} Pick a category, then a product from the menu below.`),
        quote(`${e('stock')} Then set the quantity and pay — all right here.`),
      ].join('\n')
    );

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ord:pickcat')
    .setPlaceholder('Choose a category…');

  if (categories.length) {
    menu.addOptions(
      categories.slice(0, 25).map((c) => {
        const emoji = eComp(c.name, c.emoji);
        const option = {
          label: plain(c.name).slice(0, 100) || 'Category',
          value: String(c.id),
          description: plain(c.description || 'Browse products').slice(0, 100),
        };
        if (emoji) option.emoji = emoji;
        return option;
      })
    );
  } else {
    const emptyEmoji = eComp('cancelled');
    const option = { label: 'No categories available', value: 'none' };
    if (emptyEmoji) option.emoji = emptyEmoji;
    menu.addOptions(option).setDisabled(true);
  }

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        setCompEmoji(
          new ButtonBuilder()
            .setCustomId(`ord:leave:${userId}`)
            .setLabel('Leave')
            .setStyle(ButtonStyle.Danger),
          eComp('cancelled')
        )
      ),
    ],
  };
}

// ── Product: every detail lives here ───────────────────────────────────────

/**
 * The product page. This is where everything stripped from the category list
 * ends up — description in full, stock, quantity limits, delivery mode — so a
 * customer can make the decision without a second round trip. Every meta row
 * is a grey `>` quote line under the description.
 */
function productDetails(category, product, userId) {
  const lines = (product.description || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 18);

  const min = product.minimum_quantity || 1;
  const max = product.maximum_quantity || 10;
  const delivery = (product.delivery_type || 'manual').replace(/^./, (c) => c.toUpperCase());

  const embed = brand(COLORS.black)
    .setTitle(lead(eMaybe(product.name, product.emoji), product.name))
    .setDescription(
      [
        ...heroLines(`${category.name}  ${DOT}  ${availability(product)}`),
        '',
        ...(lines.length ? lines : ['*Premium digital product — contact staff for details.*']),
        '',
        section('Details'),
        quote(`${e('money')} Price  ${DOT}  **${fmtMoney(product.price)}** each`),
        quote(`${e('stock')} Stock  ${DOT}  ${stockBadge(product)}`),
        quote(`${e('delivery')} Delivery  ${DOT}  ${delivery}`),
        quote(`${e('order')} Quantity  ${DOT}  \`${min}\` – \`${max}\``),
        quote(`${e('review')} Checkout questions  ${DOT}  ${questionsLabel(product)}`),
        quote(`${e('star')} Ordered by  ${DOT}  <@${userId}>`),
        '',
        quote(`${e('cart')} Hit Buy Now to open your private order ticket — only you can use it.`),
      ].join('\n')
    );

  if (product.image_url) embed.setImage(product.image_url);
  else {
    const banner = bannerUrl();
    if (banner) embed.setImage(banner);
  }

  const logo = logoUrl();
  if (logo) embed.setThumbnail(logo);

  const row = new ActionRowBuilder().addComponents(
    setCompEmoji(
      new ButtonBuilder()
        .setCustomId(`shop:buy:${product.id}:${userId}`)
        .setLabel('Buy Now')
        .setStyle(ButtonStyle.Success),
      eComp('cart', product.emoji)
    ),
    setCompEmoji(
      new ButtonBuilder()
        .setCustomId(`shop:back:cat:${category.id}`)
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary),
      eComp('shop')
    )
  );

  return { embeds: [embed], components: [row] };
}

module.exports = { shopPanel, categoryRow, categoryRows, categoryMenu, productDetails, pickProductView, buyNowMenuView, tabRow, vouchesTab, dealsTab };
