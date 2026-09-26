'use strict';

const orders = require('../orders/orders');
const staff = require('../tickets/staff');
const { e } = require('../utils/embeds');

module.exports = [
  {
    name: 'close',
    level: 'staff',
    usage: '!close  (inside an order ticket)',
    run: async (message) => {
      const order = orders.getByChannel(message.channel.id);
      if (!order) return message.reply(`${e('warning')} This is not an order ticket channel.`);
      await message.reply(`${e('lock')} Closing ticket…`);
      await staff.closeTicket(order, message.author.id, 'Closed via !close');
    },
  },
  {
    name: 'cancel',
    level: 'staff',
    usage: '!cancel <orderId>',
    run: async (message, rest) => {
      const id = rest.trim().toUpperCase();
      const order = orders.getByOrderId(id);
      if (!order) return message.reply(`${e('warning')} Order not found.`);
      if (['completed', 'refunded'].includes(order.order_status)) {
        return message.reply(`${e('warning')} This order is already finalized.`);
      }
      orders.setStatus(order.order_id, 'cancelled', message.author.id, 'Cancelled by staff');
      await message.reply(`${e('completed')} Order \`${id}\` cancelled.`);
      if (order.ticket_channel_id) {
        const channel = await message.guild.channels.fetch(order.ticket_channel_id).catch(() => null);
        if (channel) {
          const { brand, COLORS } = require('../utils/embeds');
          const embed = brand(COLORS.danger)
            .setTitle(`${e('cancelled')} ORDER CANCELLED`)
            .setDescription(`Order \`${order.order_id}\` has been cancelled by staff.`);
          await channel.send({ embeds: [embed] }).catch(() => {});
        }
      }
    },
  },
  {
    name: 'note',
    level: 'staff',
    usage: '!note <orderId> <text>',
    run: async (message, rest) => {
      const spaceIdx = rest.indexOf(' ');
      const id = spaceIdx === -1 ? '' : rest.slice(0, spaceIdx).trim();
      const text = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();
      if (!id || !text) return message.reply('Usage: `!note <orderId> <text>`');
      const order = orders.getByOrderId(id.toUpperCase());
      if (!order) return message.reply(`${e('warning')} Order not found.`);

      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const entry = `[${stamp} • ${message.author.tag}] ${text.slice(0, 1000)}`;
      const prev = order.staff_note ? `${order.staff_note}\n` : '';
      orders.update(order.order_id, { staff_note: (prev + entry).slice(0, 4000) });
      orders.addEvent(order.order_id, 'staff_note', message.author.id, text.slice(0, 200));
      await message.reply(`${e('order')} Note saved. Staff notes are never visible to customers.`);
    },
  },
];
