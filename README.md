# ✦ X SHOP — Premium Discord Shop Bot

A production-ready **digital marketplace** inside Discord, with a luxury purple / black / violet design.

> ✦ **X SHOP** — Premium Digital Marketplace
> Fast • Secure • Simple

**The core requirement:** the shopping menu is **PUBLIC**. Customers type `buy` in the shop channel and browse categories & products where everyone can see them. Only after clicking **Buy Now** does the bot create a **private order ticket** for that customer.

---

## Customer Flow

```
buy (in shop channel)  →  PUBLIC X SHOP panel  →  category select  →  product select
      →  product details  →  🛒 BUY NOW  →  PRIVATE ticket  →  quantity  →  order questions
      →  payment method  →  order summary  →  QR / payment details  →  payment screenshot
      →  staff verification  →  delivery  →  🎉 order completed
```

Browsing is shared; **purchase actions are user-locked** — if someone else clicks another customer's Buy button they get:

> ❌ This shopping session belongs to another customer.

## Features

- **Public storefront** — embed + select menus posted in the shop channel, auto-replaced on each `buy`
- **Private order tickets** — permission-locked channels, auto-named `order-username-product`
- **Guided order flow** — quantity (select + custom modal), per-product questions (modals), payment method, order summary with Confirm / Edit / Cancel
- **Payments** — configurable UPI / Bitcoin / Crypto (or any custom method), QR image attachment, live total `unit price × quantity` (customers can never edit totals)
- **Payment proof + staff panel** — auto-detects screenshot uploads, staff Approve / Reject / Request-new-proof with optional reason, Mark Delivered with confirm, private staff notes
- **Owner notifications** — full-details DM (and log channels) for: new order, payment method selected, proof uploaded, approved, rejected, cancel, new-proof request, completed. Every DM carries the customer, order ID, product, quantity, unit price, total, payment method, clickable ticket link, the customer's order answers and (when present) the payment-proof link
- **Full status system** — 🟡 PENDING → 🟠 AWAITING PAYMENT → 🔵 PAYMENT REVIEW → 🟣 PROCESSING → 🟢 COMPLETED (+ 🔴 CANCELLED / ⚫ REFUNDED), every change recorded in `order_events`
- **Database-driven** — SQLite (better-sqlite3): categories, products, orders, payment methods, settings. No products hard-coded.
- **Anti-spam & security** — buy cooldown, ticket cooldown, max active orders, duplicate-order prevention, proof cooldown, ownership validation on every interaction, permission checks on every command, `.env` for secrets
- **Logging** — separate order / payment / staff / error channels
- **Stats** — totals, revenue, today's numbers, top products, top customers

---

## Setup

### 1. Discord application

1. Create an app at the [Discord Developer Portal](https://discord.com/developers/applications) → **Bot**.
2. Enable the **Message Content Intent** (required for the `buy` trigger and prefix commands).
3. Invite the bot with:
   `https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=125968&scope=bot%20applications.commands`
   (View Channels, Manage Channels, Manage Messages, Send Messages, Embed Links, Attach Files, Read History)
   ⚠️ The scope must include **both** `bot` and `applications.commands`, otherwise slash
   commands (`/help`, `/orders`, …) cannot be registered (403 on registration).

### 2. Configure

```bash
copy .env.example .env   # Windows  (or: cp .env.example .env)
```

Fill in `.env`:

| Variable | Required | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` / `CLIENT_ID` | ✅ | From the developer portal |
| `GUILD_ID` | recommended | Your server id |
| `OWNER_ID` | ✅ | Gets order DM notifications + full admin rights |
| `OWNER_IDS` | optional | **Extra owners**, comma/space separated (`111111111111111111,222222222222222222`) — merged with `OWNER_ID`; every owner gets the same DMs + admin rights |
| `SHOP_CHANNEL_ID` | ✅ | The public storefront channel |
| `STAFF_ROLE_ID` | ✅ | Sees tickets & verification buttons |
| `ORDER_CATEGORY_ID` | recommended | Category where tickets are created |
| `ORDER_/PAYMENT_/STAFF_/ERROR_LOG_CHANNEL_ID` | optional | Log channels |
| `ADMIN_ROLE_ID`, `PREFIX`, `BUY_TRIGGERS`, `CURRENCY` (default `$`), cooldowns | optional | See `.env.example` |
| `BOT_ACTIVITY_TYPE` / `BOT_ACTIVITY_TEXT` / `BOT_ACTIVITY_EMOJI` / `BOT_ACTIVITY_URL` / `BOT_STATUS` | optional | Bot presence — `LISTENING` + `X SHOP • type "buy"` shows *Listening to …*; `PLAYING`/`STREAMING`/`WATCHING`/`COMPETING` also supported (default `WATCHING`, status `online`). `BOT_ACTIVITY_URL` is required only for `STREAMING` |
| `ORDER_REVIEW_TARGET` / `ORDER_REVIEW_CHANNEL_ID` | optional | Where the staff payment-verification panel (Approve / Reject / Request proof) is delivered — `dm` (owner DMs, **default**), `channel`, or `both`. The panel is **never** posted inside the customer's ticket |

### 3. Run

```bash
npm install
npm start
```

The database (`data/xshop.sqlite`) is created and **seeded automatically** with the starter catalog and UPI / Bitcoin / Crypto payment methods. The Nitro category ships with:

| Product | Price |
| --- | --- |
| 🚀 14x Boosts | $2.50 |
| 🚀 28x Boosts | $5.00 |
| 🎁 Nitro Booster GL | $5.50 |
| 🎁 Nitro Basic GL | $2.00 |
| 🪪 Nitro ID — 1 Month | $0.50 |
| 🪪 Nitro ID — 3 Months | $1.50 |
| 💳 Nitro VCC | $8.00 |
| 🎟️ Nitro Promo | $3.00 |
| 🎨 Nitro Deco | $1.50 |

plus the Gaming, Entertainment, Social and More categories. Everything is editable with the admin commands.

### 4. Post the shop panel

In the shop channel, either type **`buy`** or run **`!panel`** as an admin.

### 5. Configure payments

```text
!setpayfield upi upi_id=yourname@upi name=Your Name
!setqr upi            ← attach the QR image to this message
!setpayfield bitcoin coin=BTC network=Bitcoin wallet=bc1q...
!setpayfield crypto coin=USDT network=TRC20 wallet=TXxx...
```

Methods are shown in the customer payment menu while **active**. Use `!togglepayment <key>` to
hide/show one, and `!setpayfield <key> upi_id=… name=…` to fill in its details.
Two UPI wallets ship by default (`upi`, `upi2`) — configure each with its own UPI ID and QR:

```text
!setpayfield upi  upi_id=yourname@upi   name=Your Name
!setqr upi                             ← attach QR image
!setpayfield upi2 upi_id=second@upi    name=Your Name 2
!setqr upi2                            ← attach QR image
```

### Web dashboard

Starts automatically with the bot whenever `WEB_DASHBOARD_PASSWORD` is set (default
`http://localhost:3000`). Everything is manageable from the browser:

| Page | What you can do |
| --- | --- |
| **Dashboard** | Revenue / orders / pipeline KPIs, 14-day revenue chart, top products, top customers, payment mix |
| **Orders** | All orders with status / payment / search filters, pagination, **`/orders.csv`** export |
| **Order detail** | Approve · reject · request proof · deliver · cancel · refund · force-deliver · status override · staff notes · status history |
| **Customers** | Per-customer ledger (lifetime value, order counts), **purchase history per customer**, block / unblock |
| **Catalog** | Create / edit / delete products **and stock**, categories, prices, min–max qty, images, hide/show |
| **Payments** | Configure UPI IDs / wallets, instructions, QR URL, enable / disable per method |
| **Emoji Studio** | Assign custom emojis to every UI key, live preview, re-scan server emojis |
| **Activity Log** | Every order event + bot errors, newest first |
| **Settings** | Maintenance mode toggle, environment overview, database settings editor |

Security: cookie sessions, CSRF-protected forms, login rate-limiting (5 tries → 15 min lock),
and every order action reuses the exact same services as the Discord staff panel.
The dashboard is locked unless `WEB_DASHBOARD_PASSWORD` is set.

### Custom server emojis (`!setemoji` / `!resetemoji` / `!emojis`)

The shop UI is emoji-key driven — panel, menus, product pages, tickets, staff panel and
owner DMs all resolve these keys. Four ways to make them premium:

1. **Auto:** upload custom emojis in your server **named exactly like a key** (e.g. `nitro`,
   `cart`, `crown`) — they are picked up automatically on startup.
2. **Upload from Discord:** `!addemoji <name>` with an image attached (or reply to a message
   with an image, or pass a URL) — the bot uploads the emoji to the server for you and
   auto-binds it when the name matches a key. 👑 `!delemoji <name>` removes it again.
3. **Manual:** run `!setemoji <key> <:name:id>` to map any key to any server emoji
   (right-click the emoji in Discord → *Copy Link* to get the ID, or type `:name:`).
4. **Fallback:** without any custom emoji, clean unicode emojis are used.

`!emojis` lists every key with its current source. `!resetemoji <key>` reverts to the fallback.

Keys: `shop` `cart` `nitro` `gaming` `entertainment` `social` `more` `boost` `gift` `id` `card`
`promo` `deco` `cash` `money` `crypto` `bitcoin` `upi` `ticket` `order` `pending` `review`
`processing` `completed` `cancelled` `refunded` `staff` `delivery` `stock` `star` `crown`
`diamond` `fire` `sparkle` `heart` `bell`

### Shop branding images (`!setbanner` / `!setlogo`)

`!setbanner <url>` (or attach an image) sets the big image on the main shop panel;
`!setlogo <url>` sets the panel thumbnail. Use `off` to remove either.

### Slash commands (`/help` · `/orders` · `/support`)

Customer-facing slash commands, registered automatically on startup (guild-scoped when
`GUILD_ID` is set, otherwise global):

- `/help` — how to order, status meanings, support entry points
- `/orders` — your order history with status badges and pagination
- `/support` — open a private support ticket (Payment / Order / Product / Refund / Other)

---

## Admin Commands

Prefix defaults to `!`. 👑 = admin (owner / Administrator / `ADMIN_ROLE_ID`) · 🛡️ = staff (`STAFF_ROLE_ID`).

| Catalog | |
| --- | --- |
| 👑 `!addcategory <name> \| <emoji> \| <description>` | Add a category |
| 👑 `!editcategory <id> name=… emoji=… desc=… status=active\|hidden position=…` | Edit |
| 👑 `!deletecategory <id>` | Delete (and its products) |
| 🛡️ `!categories` | List categories |
| 👑 `!addproduct <category> \| <name> \| <price> \| <description> \| <emoji> \| <stock>` | `stock = -1` = unlimited |
| 👑 `!editproduct <id> name=… price=… stock=… min=… max=… desc=… status=… image=…` | Edit any field |
| 👑 `!deleteproduct <id>` · 👑 `!setprice <id> <price>` · 👑 `!setstock <id> <n\|unlimited>` | Quick edits |
| 👑 `!setquestions <id> \| Roblox Username \| Package` | Per-product order questions (max 5, `clear` to reset) |
| 🛡️ `!products [categoryId]` | List products |

| Payments | |
| --- | --- |
| 👑 `!setpayment <key> \| <label> \| <emoji>` | Create/upsert a method |
| 👑 `!setpayfield <key> field=value …` | `upi_id`, `name`, `wallet`, `coin`, `network`, `instructions` |
| 👑 `!setqr <key>` + attached image | Attach QR (stored in `assets/qr/`) |
| 🛡️ `!payments` · 👑 `!togglepayment <key>` · 👑 `!delpayment <key>` | Manage |
| 👑 `!setemoji <key> <emoji>` · 👑 `!resetemoji <key>` · 🛡️ `!emojis` | Custom server emojis in the UI |
| 👑 `!addemoji <name>` + image · 👑 `!delemoji <name>` | Upload / remove server emojis |
| 👑 `!setbanner <url\|off>` · 👑 `!setlogo <url\|off>` | Shop panel imagery |

| Orders & tickets | |
| --- | --- |
| 🛡️ `!orders [status]` · 🛡️ `!order <orderId>` | Browse / inspect orders |
| 👑 `!stats` · 👑 `!refund <orderId>` | Statistics / refunds |
| 🛡️ `!close` (in ticket) · 🛡️ `!cancel <orderId>` · 🛡️ `!note <orderId> <text>` | Ticket control |

| System | |
| --- | --- |
| 👑 `!maintenance on\|off` · 👑 `!panel [channelId]` | Maintenance mode / repost panel |
| 👑 `!doctor` | Live permission & setup report (bot perms, shop channel, ticket category, staff role, owners, payments + a self-deleting test ticket) |
| 🛡️ `!xhelp` · 🛡️ `!ping` | Command list / latency |

Anyone (including customers) can use:

| Public | |
| --- | --- |
| `!help` | How-to-order guide, order status meanings, support info (staff also get a `!xhelp` hint) |

Inside every ticket, staff also get the panel buttons: 🔎 Order Info · 💳 Payment · ✅ Approve · ❌ Reject · 🔄 Request Proof · 📦 Mark Delivered · 📝 Staff Note · 🔒 Close.

---

## Stock & quantities

- `stock = -1` means unlimited; otherwise stock decrements when an order is **delivered**.
- Per-product `min`/`max` quantity is enforced against stock at order time.
- The total is always computed server-side: `unit price × quantity`.

## Project structure

```
x-shop/
├── src/
│   ├── index.js               # entry point
│   ├── config/config.js       # .env loading & validation
│   ├── events/                # ready, messageCreate, interactionCreate
│   ├── commands/              # prefix admin commands (registry)
│   ├── shop/                  # public panel, views, buy handlers
│   ├── tickets/               # ticket creation, customer flow, staff panel
│   ├── payments/              # payment method config
│   ├── orders/                # order model, status history, stats
│   ├── products/              # product/category queries
│   ├── database/              # sqlite schema + seed
│   ├── services/              # logs, owner notify, anti-spam, order embeds
│   └── utils/                 # embeds, perms, ids, parsers
├── data/                      # xshop.sqlite (auto-created)
├── assets/qr/                 # payment QR images
├── scripts/smoke.js           # offline test: npm run smoke
├── .env.example
└── package.json
```

## Adding new products later

Everything is database-driven — add a category and products with the commands above, type `buy` in the shop channel to refresh the panel, and the new items appear instantly. **No code changes required.**

## UI refresh — black custom-emoji shop

The Discord shop UI keeps the existing shop/order/ticket system, but uses a black/obsidian storefront style and custom-emoji-first components.

### Optional application emoji sync

The project includes the same idea as ASTRYX's emoji sync: source emoji assets are downloaded from Discord CDN and uploaded to the bot's application emoji collection.

Add these to `.env` (they are already part of the normal config):

```env
DISCORD_TOKEN=your_bot_token
CLIENT_ID=your_application_id
```

Then run:

```bash
npm run sync-emojis
```

The generated application emoji mapping is saved to:

```text
src/utils/applicationEmojis.json
```

Restart the bot after syncing.

If you do not run the sync command, the UI can still use the source custom emoji mentions when the bot can access those emojis in a guild.
