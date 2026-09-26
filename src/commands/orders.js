'use strict';

const { brand, COLORS, fmtMoney, statusLine, quote, section, DOT, e } = require('../utils/embeds');
const orders = require('../orders/orders');
const methods = require('../payments/methods');
const { db } = require('../database/db');
const orderViews = require('../services/orderViews');
const { toInt } = require('../utils/parse');
const { notifyOwner } = require('../services/notify');
const { orderLog, staffLog } = require('../services/logs');

module.exports = [
  {
    name: 'orders',
    level: 'staff',
    usage: '!orders [status]',
    run: async (message, rest) => {
      const status = rest.trim().toLowerCase();
      const rows = status
        ? db
            .prepare('SELECT * FROM orders WHERE order_status = ? ORDER BY id DESC LIMIT 10')
            .all(status)
        : db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 10').all();
      const lines = rows.map(
        (o) =>
          `\`${o.order_id}\` • <@${o.discord_user_id}> • ${o.product_name} × ${o.quantity} • ${fmtMoney(
            o.total_price
          )} • ${statusLine(o.order_status)}`
      );
      const embed = brand(COLORS.dark)
        .setTitle(`${e('delivery')} ORDERS${status ? ` — ${status.toUpperCase()}` : ''} (latest 10)`)
        .setDescription(lines.join('\n') || 'No orders found.');
      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'order',
    level: 'staff',
    usage: '!order <orderId>',
    run: async (message, rest) => {
      const id = rest.trim().toUpperCase();
      const order = orders.getByOrderId(id);
      if (!order) return message.reply(`${e('warning')} Order not found.`);
      const events = orders.eventsFor(order.order_id, 10);
      await message.reply({ embeds: [orderViews.orderInfoEmbed(order, events)] });
    },
  },
  {
    name: 'stats',
    level: 'admin',
    usage: '!stats',
    run: async (message) => {
      const s = orders.stats();
      const topProducts = orders.topProducts();
      const topCustomers = orders.topCustomers();

      const embed = brand(COLORS.primary)
        .setTitle(`${e('stock')} X SHOP STATISTICS`)
        .setDescription(
          [
            quote(`${e('delivery')} Total Orders ${DOT} **${s.total ?? 0}**`),
            quote(`${e('pending')} Active Orders ${DOT} **${s.active ?? 0}**`),
            quote(`${e('completed')} Completed ${DOT} **${s.completed ?? 0}**`),
            quote(`${e('cancelled')} Cancelled ${DOT} **${s.cancelled ?? 0}**`),
            quote(`${e('refunded')} Refunded ${DOT} **${s.refunded ?? 0}**`),
            '',
            quote(`${e('money')} Total Revenue ${DOT} **${fmtMoney(s.revenue ?? 0)}**`),
            quote(`${e('order')} Today's Orders ${DOT} **${s.today_orders ?? 0}**`),
            quote(`${e('money')} Today's Revenue ${DOT} **${fmtMoney(s.today_revenue ?? 0)}**`),
            ...(topProducts.length
              ? [
                  '',
                  section(`${e('star')} Top Products`),
                  ...topProducts.map((p, i) =>
                    quote(`${i + 1}. ${p.product_name} ${DOT} ${p.c} sold ${DOT} ${fmtMoney(p.revenue)}`)
                  ),
                ]
              : []),
            ...(topCustomers.length
              ? [
                  '',
                  section(`${e('crown')} Top Customers`),
                  ...topCustomers.map((c, i) =>
                    quote(`${i + 1}. <@${c.discord_user_id}> ${DOT} ${c.c} orders ${DOT} ${fmtMoney(c.revenue)}`)
                  ),
                ]
              : []),
          ].join('\n')
        );

      await message.reply({ embeds: [embed] });
    },
  },
  {
    name: 'refund',
    level: 'admin',
    usage: '!refund <orderId>',
    run: async (message, rest) => {
      const id = rest.trim().toUpperCase();
      const order = orders.getByOrderId(id);
      if (!order) return message.reply(`${e('warning')} Order not found.`);
      if (order.order_status === 'refunded') return message.reply(`${e('warning')} Order is already refunded.`);
      orders.setStatus(order.order_id, 'refunded', message.author.id, 'Refunded by admin');
      const fresh = orders.getByOrderId(order.order_id);
      await message.reply(`${e('completed')} Order \`${id}\` marked as refunded.`);
      await notifyOwner(orderViews.staffActionEmbed('ORDER REFUNDED', fresh, message.author.id));
      await orderLog(orderViews.staffActionEmbed('ORDER REFUNDED', fresh, message.author.id));
      await staffLog(orderViews.staffActionEmbed('ORDER REFUNDED', fresh, message.author.id));
    },
  },
];
