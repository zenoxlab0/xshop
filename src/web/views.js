'use strict';

/**
 * Server-rendered HTML for the X SHOP web dashboard.
 * Vanilla HTML + the static stylesheet — no client framework, no CDN calls.
 */

const { fmtMoney, ORDER_STATUS, statusLine } = require('../utils/embeds');

const esc = (value) =>
  String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const attr = esc;
// Discord custom-emoji mentions only render inside Discord — on the website
// they would show as raw <:name:id> text, so they are stripped from HTML.
const stripTag = (value) => String(value ?? '').replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, '').trim();
const money = (n) => esc(fmtMoney(n));
const num = (n) => esc(Number(n || 0).toLocaleString('en-IN'));
const when = (t) => esc(String(t || '—').replace('T', ' ').slice(0, 19));

const statusBadge = (status) => {
  const s = ORDER_STATUS[status] || { label: String(status || '—').toUpperCase(), emoji: '✦' };
  const tone = {
    completed: 'ok',
    processing: '',
    pending: 'warn',
    awaiting_payment: 'warn',
    payment_review: 'info',
    cancelled: 'bad',
    refunded: 'mute',
  }[status];
  return `<span class="badge ${tone || ''}">${esc(s.label)}</span>`;
};

const payBadge = (status) => {
  const tone = { verified: 'ok', rejected: 'bad', unpaid: 'mute', refunded: 'mute' }[status] || 'warn';
  return `<span class="badge ${tone}">${esc(String(status || 'unpaid').toUpperCase())}</span>`;
};

const NAV_SECTIONS = [
  {
    group: 'Overview',
    items: [
      { href: '/', label: 'Dashboard', icon: '✦' },
      { href: '/orders', label: 'Orders', icon: '🧾' },
      { href: '/activity', label: 'Activity Log', icon: '📡' },
      { href: '/customers', label: 'Customers', icon: '🧑' },
    ],
  },
  {
    group: 'Catalog',
    items: [
      { href: '/catalog', label: 'Catalog', icon: '🛍️' },
      { href: '/payments', label: 'Payments', icon: '💳' },
    ],
  },
  {
    group: 'Look & Feel',
    items: [
      { href: '/emojis', label: 'Emoji Studio', icon: '✨' },
      { href: '/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
];

function sidebar(active) {
  const sections = NAV_SECTIONS.map(
    (section) => `
      <div class="group">${esc(section.group)}</div>
      ${section.items
        .map(
          (item) =>
            `<a href="${attr(item.href)}" class="${
              active === item.href ? 'active' : ''
            }"><span>${item.icon}</span> ${esc(item.label)}</a>`
        )
        .join('')}`
  ).join('');
  return `
  <aside class="side">
    <div class="brandmark">
      <div class="logo">✦</div>
      <div>
        <b>X SHOP</b>
        <div class="brandsub">Premium Control</div>
      </div>
    </div>
    <nav class="nav">${sections}</nav>
    <div class="brandsub" style="margin-top:22px">✦ X SHOP • Premium Digital Marketplace</div>
  </aside>`;
}

function layout({ title, active, body, flash, csrf }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>✦ X SHOP — ${esc(title)}</title>
<link rel="stylesheet" href="/assets/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>✦</text></svg>">
</head>
<body>
<input type="hidden" id="csrf" value="${attr(csrf || '')}">
<div class="shell">
  ${sidebar(active)}
  <main class="main">
    <div class="topbar">
      <div>
        <div class="crumb">✦ X SHOP • Premium Digital Marketplace</div>
        <h1>${esc(title)}</h1>
      </div>
      <div class="who">
        <span class="badge info">Dashboard</span>
        <a class="btn sm" href="/logout">Sign out</a>
      </div>
    </div>
    ${flash || ''}
    ${body}
    <footer class="foot">✦ X SHOP control center • Fast • Secure • Simple</footer>
  </main>
</div>
</body>
</html>`;
}

function flashBox(flash) {
  if (!flash || !flash.message) return '';
  return `<div class="flash ${flash.type === 'err' ? 'err' : 'ok'}">${
    flash.type === 'err' ? '⚠️' : '✅'
  } ${esc(flash.message)}</div>`;
}

function loginPage({ error, csrf } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>✦ X SHOP — Sign in</title>
<link rel="stylesheet" href="/assets/style.css">
</head>
<body>
<div class="login-wrap">
  <div class="card login">
    <div class="logo">✦</div>
    <h2 style="text-align:center;letter-spacing:2px">X SHOP</h2>
    <p class="hint" style="text-align:center;margin-top:0">Premium Digital Marketplace — control center</p>
    ${error ? `<div class="flash err">⚠️ ${esc(error)}</div>` : ''}
    <form method="POST" action="/login">
      <input type="hidden" name="_csrf" value="${attr(csrf || '')}">
      <label for="password">Dashboard password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required autofocus>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:16px">Enter dashboard</button>
    </form>
    <p class="hint" style="text-align:center;margin-top:14px">Password comes from <code>WEB_DASHBOARD_PASSWORD</code> in <code>.env</code>.</p>
  </div>
</div>
</body>
</html>`;
}

function statCard(label, value, sub, tone) {
  return `<div class="card kpi">
    <div class="lbl">${esc(label)}</div>
    <div class="val${tone ? ` ${tone}` : ''}">${value}</div>
    ${sub ? `<div class="hint">${sub}</div>` : ''}
  </div>`;
}

function barChart(series) {
  const max = Math.max(1, ...series.map((d) => d.revenue));
  return `<div class="chart">${series
    .map((d) => {
      const h = Math.max(4, Math.round((d.revenue / max) * 100));
      const day = d.day.slice(8);
      return `<div class="bar" style="height:${h}%" title="${attr(d.day)} — ${money(
        d.revenue
      )} · ${d.orders} order(s)"><span>${esc(day)}</span></div>`;
    })
    .join('')}</div>`;
}

function miniBars(rows, { labelKey, valueKey }) {
  const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
  if (!rows.length) return '<div class="empty">No data yet.</div>';
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="line">
        <span>${esc(r[labelKey] || '—')}</span>
        <b>${money(r[valueKey])}</b>
        <span class="track"><i style="width:${Math.max(
          3,
          Math.round(((Number(r[valueKey]) || 0) / max) * 100)
        )}%"></i></span>
      </div>`
    )
    .join('')}</div>`;
}

function ordersTable(rows, { compact = false } = {}) {
  if (!rows.length) return '<div class="empty">No orders match this view.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Order</th><th>Customer</th><th>Product</th><th class="right">Qty</th>
      <th class="right">Total</th><th>Payment</th><th>Status</th><th>Created</th><th></th>
    </tr></thead>
    <tbody>
    ${rows
      .map(
        (o) => `<tr>
        <td class="mono">${esc(o.order_id)}</td>
        <td>${o.username ? `@${esc(o.username)}` : '—'}${
          compact ? '' : `<div class="hint mono">${esc(o.discord_user_id || '')}</div>`
        }</td>
        <td>${esc(o.product_name || '—')}${compact ? '' : ''}</td>
        <td class="right">${esc(o.quantity || 0)}</td>
        <td class="right">${money(o.total_price)}</td>
        <td>${esc(o.payment_method || '—')}<div>${payBadge(o.payment_status)}</div></td>
        <td>${statusBadge(o.order_status)}</td>
        <td class="nowrap hint">${when(o.created_at)}</td>
        <td class="right"><a class="btn sm primary" href="/orders/${attr(
          encodeURIComponent(o.order_id)
        )}">Open</a></td>
      </tr>`
      )
      .join('')}
    </tbody></table></div>`;
}

function dashboardPage(data) {
  const { k, series, counts, recent, topP, topC, methods } = data;
  const body = `
  <div class="grid g4">
    ${statCard('Total revenue', money(k.revenue), `Today: ${money(k.revenue_today)}`)}
    ${statCard('Orders', num(k.total), `Today: ${num(k.orders_today)}`)}
    ${statCard('Open orders', num(k.open), `${num(k.awaiting_review)} awaiting payment review`)}
    ${statCard('Completed', num(k.completed), `Avg order ${money(k.aov)}`)}
  </div>

  <div class="split" style="margin-top:16px">
    <div class="card">
      <h2>Revenue — last 14 days</h2>
      ${barChart(series)}
      <div class="hint" style="margin-top:24px">Bars scale to the best day in the window. Hover a bar for exact numbers.</div>
    </div>
    <div class="card">
      <h2>Order pipeline</h2>
      <dl class="kv">
        ${Object.keys(ORDER_STATUS)
          .map(
            (s) =>
              `<dt>${esc(ORDER_STATUS[s].label)}</dt><dd>${statusBadge(s)} <b>${num(
                counts[s] || 0
              )}</b></dd>`
          )
          .join('')}
      </dl>
      <div class="row-actions" style="margin-top:14px">
        <a class="btn sm" href="/orders?status=awaiting_payment">Review payments</a>
        <a class="btn sm" href="/orders?status=processing">Processing</a>
      </div>
    </div>
  </div>

  <div class="split" style="margin-top:16px">
    <div class="card">
      <h2>Latest orders</h2>
      ${ordersTable(recent, { compact: true })}
      <div class="row-actions" style="margin-top:12px"><a class="btn sm" href="/orders">All orders</a></div>
    </div>
    <div>
      <div class="card">
        <h2>Top products</h2>
        ${miniBars(topP, { labelKey: 'product_name', valueKey: 'revenue' })}
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Payment mix</h2>
        ${
          methods.length
            ? miniBars(methods, { labelKey: 'method', valueKey: 'revenue' })
            : '<div class="empty">No payments recorded yet.</div>'
        }
      </div>
      <div class="card" style="margin-top:16px">
        <h2>Top customers</h2>
        ${
          topC.length
            ? `<div class="timeline">${topC
                .map(
                  (c) =>
                    `<div class="item"><b>@${esc(c.username || c.discord_user_id)}</b> — ${money(
                      c.revenue
                    )}<small class="mono">${esc(c.discord_user_id)} • ${num(c.orders)} order(s)</small></div>`
                )
                .join('')}</div>`
            : '<div class="empty">No customers yet.</div>'
        }
      </div>
    </div>
  </div>`;
  return { title: 'Dashboard', active: '/', body };
}

function ordersPage(data) {
  const { result, filters, counts } = data;
  const statusOptions = ['all', ...Object.keys(ORDER_STATUS)]
    .map(
      (s) =>
        `<option value="${attr(s)}" ${filters.status === s ? 'selected' : ''}>${
          s === 'all' ? 'All statuses' : esc(ORDER_STATUS[s].label)
        }</option>`
    )
    .join('');
  const body = `
  <div class="grid g4" style="margin-bottom:16px">
    ${statCard('Matching orders', num(result.total), 'Filtered result count')}
    ${statCard('Open', num(counts.all - counts.completed - counts.cancelled - counts.refunded), 'Active pipeline')}
    ${statCard('Awaiting payment', num(counts.pending + counts.awaiting_payment), 'Customer action needed')}
    ${statCard('In review', num(counts.payment_review), 'Proof uploaded, staff check')}
  </div>

  <div class="card">
    <form class="filters" method="GET" action="/orders">
      <div>
        <label>Status</label>
        <select name="status">${statusOptions}</select>
      </div>
      <div>
        <label>Payment status</label>
        <select name="payment">
          <option value="">Any</option>
          ${['unpaid', 'verified', 'rejected', 'refunded']
            .map(
              (p) =>
                `<option value="${attr(p)}" ${filters.payment === p ? 'selected' : ''}>${esc(
                  p.toUpperCase()
                )}</option>`
            )
            .join('')}
        </select>
      </div>
      <div style="flex:1;min-width:220px">
        <label>Search</label>
        <input name="q" value="${attr(filters.q || '')}" placeholder="Order ID, username, product, user ID">
      </div>
      <div style="min-width:120px">
        <label>Per page</label>
        <select name="limit">
          ${[25, 50, 100]
            .map((l) => `<option value="${l}" ${result.limit === l ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
      </div>
      <button class="btn primary">Apply filters</button>
      <a class="btn" href="/orders">Reset</a>
    </form>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Orders</h2>
    ${ordersTable(result.rows)}
    <div class="pager">
      <span>Page ${result.page} of ${result.pages}</span>
      ${
        result.page > 1
          ? `<a class="btn sm" href="${attr(pageUrl(filters, result.page - 1, result.limit))}">← Prev</a>`
          : ''
      }
      ${
        result.page < result.pages
          ? `<a class="btn sm" href="${attr(pageUrl(filters, result.page + 1, result.limit))}">Next →</a>`
          : ''
      }
    </div>
  </div>`;
  return { title: 'Orders', active: '/orders', body };
}

function pageUrl(filters, page, limit) {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.payment) p.set('payment', filters.payment);
  if (filters.q) p.set('q', filters.q);
  if (limit) p.set('limit', String(limit));
  p.set('page', String(page));
  return `/orders?${p.toString()}`;
}

function orderPage(data) {
  const { order, events, csrf, clientReady } = data;
  const timeline = events.length
    ? `<div class="timeline">${events
        .map(
          (ev) => `<div class="item"><b>${esc(ev.event)}</b>
            ${ev.note ? `<div>${esc(ev.note)}</div>` : ''}
            <small>${when(ev.created_at)}${ev.actor_id ? ` • by ${esc(ev.actor_id)}` : ''}</small></div>`
        )
        .join('')}</div>`
    : '<div class="empty">No events recorded.</div>';

  let answers = [];
  try {
    answers = JSON.parse(order.answers || '[]');
  } catch {
    answers = [];
  }

  const form = (fields, button, cls = '') => `
    <form method="POST" action="/api/orders/${attr(encodeURIComponent(order.order_id))}/action" class="inline">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      ${fields}
      <button class="btn sm ${cls}">${button}</button>
    </form>`;

  const actionBtn = (name, label, cls, extra = '') =>
    form(`<input type="hidden" name="action" value="${attr(name)}">${extra}`, label, cls);

  const body = `
  <div class="row-actions" style="margin-bottom:14px">
    <a class="btn sm" href="/orders">← Back to orders</a>
    ${
      order.ticket_channel_id
        ? `<span class="badge info">Ticket #${esc(order.ticket_channel_id)}</span>`
        : '<span class="badge mute">No ticket channel</span>'
    }
    ${
      clientReady
        ? '<span class="badge ok">Bot online — Discord notifications live</span>'
        : '<span class="badge warn">Bot offline — Discord messages will not be sent</span>'
    }
  </div>

  <div class="grid g4">
    ${statCard('Total', money(order.total_price), `${money(order.unit_price)} × ${esc(order.quantity || 0)}`)}
    ${statCard('Order status', statusBadge(order.order_status), `Updated ${when(order.updated_at)}`)}
    ${statCard('Payment', payBadge(order.payment_status), esc(order.payment_method || 'not selected'))}
    ${statCard('Created', esc(String(order.created_at || '').slice(0, 10)), `By @${esc(order.username || '—')}`)}
  </div>

  <div class="split" style="margin-top:16px">
    <div class="card">
      <h2>Order details</h2>
      <dl class="kv">
        <dt>Order ID</dt><dd class="mono">${esc(order.order_id)}</dd>
        <dt>Customer</dt><dd>@${esc(order.username || '—')} <span class="mono">${esc(order.discord_user_id)}</span></dd>
        <dt>Product</dt><dd>${esc(order.product_name)} <span class="hint">(id ${esc(order.product_id)})</span></dd>
        <dt>Quantity</dt><dd>${esc(order.quantity || 0)}</dd>
        <dt>Unit price</dt><dd>${money(order.unit_price)}</dd>
        <dt>Total</dt><dd><b>${money(order.total_price)}</b></dd>
        <dt>Payment method</dt><dd>${esc(order.payment_method || '—')}</dd>
        <dt>Payment proof</dt><dd>${
          order.payment_proof_url
            ? `<a href="${attr(order.payment_proof_url)}" target="_blank" rel="noopener">Open proof ↗</a>`
            : 'Not submitted'
        }</dd>
        <dt>Verified by</dt><dd>${order.verified_by ? esc(order.verified_by) : '—'}</dd>
        <dt>Ticket channel</dt><dd class="mono">${esc(order.ticket_channel_id || '—')}</dd>
        <dt>Completed</dt><dd>${when(order.completed_at)}</dd>
        <dt>Customer answers</dt><dd>${
          answers.length
            ? answers
                .map(
                  (a) =>
                    `• <b>${esc(a.label || a.id || 'Answer')}:</b> ${esc(a.value ?? a.answer ?? '')}`
                )
                .join('<br>')
            : '<span class="hint">None</span>'
        }</dd>
      </dl>
    </div>

    <div>
      <div class="card">
        <h2>Actions</h2>
        <div class="row-actions">
          ${actionBtn('approve', '✅ Approve payment', 'ok')}
          ${actionBtn('reproof', '🔄 Request new proof', 'warn')}
          ${actionBtn('deliver', '📦 Mark delivered', 'primary')}
          ${actionBtn('cancel', '❌ Cancel order', 'bad')}
          ${actionBtn('refund', '⚫ Refund', '')}
          ${actionBtn('close', '🔒 Close ticket', '')}
          ${actionBtn('deliver', '⚡ Force deliver', '', '<input type="hidden" name="force" value="1">')}
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Staff-only controls</h2>
        ${form(
          `<input type="hidden" name="action" value="reject">
           <input name="reason" placeholder="Reject reason (shown to customer)">`,
          '❌ Reject payment',
          'bad'
        )}
        <div style="height:14px"></div>
        ${form(
          `<input type="hidden" name="action" value="status">
           <select name="status">${Object.keys(ORDER_STATUS)
             .map(
               (s) =>
                 `<option value="${attr(s)}" ${order.order_status === s ? 'selected' : ''}>${esc(
                   ORDER_STATUS[s].label
                 )}</option>`
             )
             .join('')}</select>
           <input name="note" placeholder="Audit note">`,
          'Apply status'
        )}
        <div style="height:14px"></div>
        ${form(
          `<input type="hidden" name="action" value="note">
           <textarea name="note" placeholder="Internal note — customers never see this"></textarea>`,
          '📝 Save staff note'
        )}
        <div class="hint" style="margin-top:12px;white-space:pre-wrap">${
          order.staff_note ? esc(order.staff_note) : 'No staff notes yet.'
        }</div>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Status history</h2>
    ${timeline}
  </div>`;
  return { title: `Order ${order.order_id}`, active: '/orders', body };
}

function catalogPage(data) {
  const { categories, products, csrf, filter } = data;
  const catOptions = categories
    .map(
      (c) =>
        `<option value="${attr(c.id)}" ${filter === String(c.id) ? 'selected' : ''}>${esc(
          c.name
        )}</option>`
    )
    .join('');

  const body = `
  <div class="card">
    <h2>Shop sections</h2>
    <div class="tiles">
      <a class="tile ${filter ? '' : 'on'}" href="/catalog">
        <div class="tile-t">All products</div>
        <div class="tile-s">${num(products.length)} shown</div>
      </a>
      ${categories
        .map(
          (c) => `
        <a class="tile ${filter === String(c.id) ? 'on' : ''}" href="/catalog?category=${attr(c.id)}">
          <div class="tile-emoji">${esc(stripTag(c.emoji) || '•')}</div>
          <div class="tile-t">${esc(c.name)}</div>
          <div class="tile-s">${c.product_count || 0} product(s) • ${esc(c.status)}</div>
        </a>`
        )
        .join('')}
    </div>
  </div>

  <div class="split" style="margin-top:16px">
    <div class="card">
      <h2>Products ${filter ? `<span class="hint">(filtered)</span>` : ''}</h2>
      <form method="GET" action="/catalog" class="filters" style="margin-bottom:12px">
        <div style="flex:1"><label>Category</label>
          <select name="category"><option value="">All categories</option>${catOptions}</select>
        </div>
        <button class="btn sm">Filter</button>
      </form>
      ${productsTable(products, csrf)}
    </div>

    <div>
      <div class="card">
        <h2>Add product</h2>
        <form method="POST" action="/api/products">
          <input type="hidden" name="_csrf" value="${attr(csrf)}">
          <label>Category</label>
          <select name="category_id" required>
            ${categories.map((c) => `<option value="${attr(c.id)}">${esc(c.name)}</option>`).join('')}
          </select>
          <label>Name</label><input name="name" required placeholder="Nitro Gift Link">
          <label>Emoji</label><input name="emoji" placeholder="🎁 or <:key:id>">
          <label>Price</label><input name="price" required placeholder="2.50">
          <label>Stock (−1 = unlimited)</label><input name="stock" value="-1">
          <div class="two">
            <div><label>Min qty</label><input name="minimum_quantity" value="1"></div>
            <div><label>Max qty</label><input name="maximum_quantity" value="10"></div>
          </div>
          <label>Description</label><textarea name="description" placeholder="What the customer gets…"></textarea>
          <label>Image URL (banner, optional)</label><input name="image_url" placeholder="https://…">
          <label>Status</label>
          <select name="status"><option value="active">active</option><option value="hidden">hidden</option></select>
          <button class="btn primary" style="margin-top:12px">Create product</button>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Add category</h2>
        <form method="POST" action="/api/categories">
          <input type="hidden" name="_csrf" value="${attr(csrf)}">
          <label>Name</label><input name="name" required placeholder="Gaming">
          <label>Emoji</label><input name="emoji" placeholder="🎮">
          <label>Description</label><input name="description">
          <div class="two">
            <div><label>Position</label><input name="position" value="0"></div>
            <div><label>Status</label>
              <select name="status"><option value="active">active</option><option value="hidden">hidden</option></select>
            </div>
          </div>
          <button class="btn primary" style="margin-top:12px">Create category</button>
        </form>
      </div>

      <div class="card" style="margin-top:16px">
        <h2>Edit categories</h2>
        ${
          categories.length
            ? categories
                .map(
                  (c) => `
          <details class="edit" style="margin-bottom:10px">
            <summary class="btn sm">${esc(stripTag(c.emoji) || '•')} ${esc(c.name)}</summary>
            <form method="POST" action="/api/categories/${attr(c.id)}">
              <input type="hidden" name="_csrf" value="${attr(csrf)}">
              <input type="hidden" name="op" value="update">
              <label>Name</label><input name="name" value="${attr(c.name)}">
              <div class="two">
                <div><label>Emoji</label><input name="emoji" value="${attr(c.emoji || '')}"></div>
                <div><label>Position</label><input name="position" value="${attr(c.position)}"></div>
              </div>
              <label>Description</label><input name="description" value="${attr(c.description || '')}">
              <label>Status</label>
              <select name="status">
                <option value="active" ${c.status === 'active' ? 'selected' : ''}>active</option>
                <option value="hidden" ${c.status === 'hidden' ? 'selected' : ''}>hidden</option>
              </select>
              <div class="row-actions" style="margin-top:10px">
                <button class="btn sm primary">Save</button>
              </div>
            </form>
            <form method="POST" action="/api/categories/${attr(c.id)}" style="margin-top:8px">
              <input type="hidden" name="_csrf" value="${attr(csrf)}">
              <input type="hidden" name="op" value="delete">
              <button class="btn sm bad">🗑️ Delete category + products</button>
            </form>
          </details>`
                )
                .join('')
            : '<div class="empty">No categories yet.</div>'
        }
        <div class="hint">Hiding a category removes it from the Discord shop menu without deleting anything.</div>
      </div>
    </div>
  </div>`;
  return { title: 'Catalog', active: '/catalog', body };
}

function paymentsPage(data) {
  const { methods, csrf } = data;
  const fieldsFor = (method) => {
    let schema = {};
    try {
      schema = JSON.parse(method.fields || '{}');
    } catch {
      schema = {};
    }
    const entries = Object.entries(schema);
    if (!entries.length) return '<div class="hint">No fields declared.</div>';
    return entries
      .map(
        ([field, meta]) => `
      <label>${esc(meta.label || field)} <span class="hint">(${esc(field)})</span></label>
      <input name="field_${attr(field)}" value="${attr(method.values?.[field] || '')}"
        placeholder="${attr(meta.placeholder || meta.type || '')}">`
      )
      .join('');
  };

  const card = (m) => `
    <div class="card">
      <div class="row-actions" style="justify-content:space-between">
        <div>
          <h2 style="margin:0">${esc(stripTag(m.emoji) || '•')} ${esc(m.label)} <span class="hint">(${esc(m.key)})</span></h2>
          <div class="hint">${
            m.configured ? 'Configured — visible to customers' : 'Incomplete — hidden from the customer menu'
          }</div>
        </div>
        <div class="row-actions">
          <span class="badge ${m.active ? 'ok' : 'mute'}">${m.active ? 'ACTIVE' : 'DISABLED'}</span>
          <span class="badge ${m.configured ? 'info' : 'warn'}">${m.configured ? 'READY' : 'INCOMPLETE'}</span>
        </div>
      </div>
      <form method="POST" action="/api/payments/${attr(encodeURIComponent(m.key))}">
        <input type="hidden" name="_csrf" value="${attr(csrf)}">
        ${fieldsFor(m)}
        <label>Customer instructions</label>
        <textarea name="instructions" placeholder="Send the exact amount, then upload the screenshot here.">${esc(
          m.instructions || ''
        )}</textarea>
        <label>QR image URL / attachment URL <span class="hint">(use !setqr in Discord to upload a file)</span></label>
        <input name="qr_url" value="${attr(m.qr_url || '')}" placeholder="https://…/qr.png">
        <div class="two">
          <div><label>Emoji</label><input name="emoji" value="${attr(m.emoji || '')}"></div>
          <div><label>Label</label><input name="label" value="${attr(m.label)}"></div>
        </div>
        <div class="row-actions" style="margin-top:12px">
          <button class="btn primary sm">💾 Save</button>
        </div>
      </form>
      <form method="POST" action="/api/payments/${attr(encodeURIComponent(m.key))}">
        <input type="hidden" name="_csrf" value="${attr(csrf)}">
        <input type="hidden" name="op" value="toggle">
        <input type="hidden" name="active" value="${m.active ? '0' : '1'}">
        <button class="btn sm ${m.active ? 'warn' : 'ok'}" style="margin-top:8px">
          ${m.active ? '⏸️ Disable for customers' : '▶️ Enable for customers'}
        </button>
      </form>
    </div>`;

  const body = `
  <div class="card" style="margin-bottom:16px">
    <h2>Payment methods</h2>
    <div class="hint">A method is shown to customers only when it is <b>ACTIVE</b> and <b>READY</b> (all required fields filled).
    Secrets stay in this dashboard’s database — never in the bot source. Add a new method at the bottom.</div>
  </div>
  ${methods.map(card).join('')}

  <div class="card">
    <h2>Add payment method</h2>
    <form method="POST" action="/api/payments">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <div class="two">
        <div><label>Key (a-z0-9_)</label><input name="key" required placeholder="upi3"></div>
        <div><label>Label</label><input name="label" required placeholder="UPI 3"></div>
      </div>
      <div class="two">
        <div><label>Emoji</label><input name="emoji" placeholder="🇮🇳"></div>
        <div><label>Fields (comma separated)</label><input name="fields" placeholder="upi_id,name"></div>
      </div>
      <label>Customer instructions</label>
      <textarea name="instructions" placeholder="Scan the QR and upload the screenshot."></textarea>
      <label>QR image URL</label><input name="qr_url" placeholder="https://…">
      <button class="btn primary" style="margin-top:12px">Create method</button>
    </form>
  </div>`;
  return { title: 'Payments', active: '/payments', body };
}

function customersPage(data) {
  const { customers, csrf } = data;
  const rows = customers.length
    ? customers
        .map(
          (c) => `
      <tr>
        <td>@${esc(c.username || '—')}<div class="hint mono">${esc(c.discord_user_id)}</div></td>
        <td>${num(c.orders)}</td>
        <td>${money(c.spent)}</td>
        <td><span class="badge ok">${num(c.completed)}</span> <span class="badge mute">${num(
            c.orders - c.completed
          )}</span></td>
        <td>${when(c.last_order)}</td>
        <td class="row-actions">
          <a class="btn sm" href="/orders?q=${attr(encodeURIComponent(c.username || c.discord_user_id))}">Orders</a>
          <form method="POST" action="/api/customers/blacklist" class="inline">
            <input type="hidden" name="_csrf" value="${attr(csrf)}">
            <input type="hidden" name="discord_user_id" value="${attr(c.discord_user_id)}">
            <input type="hidden" name="op" value="${c.blacklisted ? 'remove' : 'add'}">
            <input name="reason" placeholder="reason" style="width:130px">
            <button class="btn sm ${c.blacklisted ? 'ok' : 'bad'}">${
            c.blacklisted ? '✅ Unblock' : '🚫 Block'
          }</button>
          </form>
        </td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="empty">No customers yet — orders will appear here automatically.</td></tr>`;

  const body = `
  <div class="card">
    <h2>Customers</h2>
    <div class="hint">Sorted by lifetime value. “Block” prevents a customer from opening new order tickets.</div>
  </div>
  <div class="card" style="margin-top:16px;overflow:auto">
    <table>
      <thead><tr><th>Customer</th><th>Orders</th><th>Lifetime value</th><th>Completed / open</th><th>Last order</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
  return { title: 'Customers', active: '/customers', body };
}

function emojisPage(data) {
  const { report, guildEmojis, keys, csrf } = data;
  const keyOptions = keys
    .map((k) => `<option value="${attr(k)}">${esc(k)}</option>`)
    .join('');

  const cards = report
    .map(
      (r) => `
    <form class="emoji-card" method="POST" action="/api/emojis">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <input type="hidden" name="key" value="${attr(r.key)}">
      <div class="emoji-preview">${r.value}</div>
      <div class="mono">${esc(r.key)}</div>
      <div class="hint">${esc(r.source)}${r.overridden ? ' ⭐' : ''}</div>
      <input name="value" placeholder="paste emoji / &lt;:name:id&gt;">
      <button class="btn sm primary">Save</button>
    </form>`
    )
    .join('');

  const gallery = guildEmojis.length
    ? guildEmojis
        .map(
          (ge) =>
            `<button type="button" class="emoji-chip" data-value="${attr(ge.mention)}" title="${attr(
              `:${ge.name}:${ge.key ? ` → matches key "${ge.key}"` : ''}`
            )}"><span>${ge.mention}</span><small>${esc(ge.name)}</small></button>`
        )
        .join('')
    : '<div class="empty">No custom emojis found on the server (or the bot is offline).</div>';

  const body = `
  <div class="card">
    <h2>Emoji studio</h2>
    <div class="hint">
      Click a server emoji below to copy it into the clipboard/paste box, or paste a custom emoji
      (<span class="mono">&lt;:name:id&gt;</span>) into a key’s field and hit <b>Save</b>.
      Saving an empty value restores the unicode fallback. Changes apply instantly — no restart.
    </div>
    <div class="gallery">${gallery}</div>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Formatted message preview</h2>
    <div class="hint">This is how product pages render with the current emojis.</div>
    <pre class="preview">${buildPreview(report)}</pre>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>UI keys (${report.length})</h2>
    <div class="emoji-grid">${cards}</div>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Reset a key</h2>
    <form method="POST" action="/api/emojis/reset">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <select name="key">${keyOptions}</select>
      <button class="btn sm warn" style="margin-top:10px">↩️ Reset to fallback</button>
    </form>
  </div>`;
  return { title: 'Emojis', active: '/emojis', body };
}

function buildPreview(report) {
  const map = {};
  for (const r of report) map[r.key] = r.value;
  const g = (k, d) => map[k] || d;
  return esc(
    [
      `╭────────────────────────────╮`,
      `　　${g('shop', '✦')} X SHOP ${g('shop', '✦')}`,
      `╰────────────────────────────╯`,
      ``,
      `${g('star', '⭐')} Premium Digital Marketplace`,
      ``,
      `${g('cart', '🛒')} Order  ${g('gift', '🎁')} Product  ${g('cash', '💰')} Payment  ${g('ticket', '🎫')} Ticket`,
      ``,
      `${g('buy', '🛒')} Buy Now   ${g('completed', '🟢')} Completed   ${g('cancelled', '🔴')} Cancelled`,
      ``,
      `✦ X SHOP • Premium Digital Marketplace`,
    ].join('\n')
  );
}

function productsTable(products, csrf, categories = []) {
  if (!products.length) {
    return '<div class="empty">No products in this section yet — add one on the right.</div>';
  }
  const catOptions = () =>
    categories.map((c) => `<option value="${attr(c.id)}">${esc(c.name)}</option>`).join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Product</th><th>Section</th><th class="right">Price</th><th class="right">Stock</th>
      <th class="right">Qty</th><th>Status</th><th class="right">Orders</th><th></th></tr></thead>
    <tbody>
    ${products
      .map(
        (p) => `<tr>
      <td><b>${esc(stripTag(p.emoji) || '•')} ${esc(p.name)}</b>${p.image_url ? ' 🖼️' : ''}
        <div class="hint mono">id ${esc(p.id)} • ${
          Array.isArray(JSON.parse(p.questions || '[]')) ? JSON.parse(p.questions || '[]').length : 0
        } question(s)</div></td>
      <td>${esc(stripTag(p.category_emoji) || '')} ${esc(p.category_name || '—')}</td>
      <td class="right">${money(p.price)}</td>
      <td class="right">${p.stock < 0 ? '∞' : num(p.stock)}</td>
      <td class="right">${esc(p.minimum_quantity)}–${esc(p.maximum_quantity)}</td>
      <td>${p.status === 'active' ? '<span class="badge ok">ACTIVE</span>' : '<span class="badge mute">HIDDEN</span>'}</td>
      <td class="right">${num(p.orders)}</td>
      <td>
        <details class="edit">
          <summary class="btn sm">Edit</summary>
          <form method="POST" action="/api/products/${attr(p.id)}">
            <input type="hidden" name="_csrf" value="${attr(csrf)}">
            <input type="hidden" name="op" value="update">
            <label>Name</label><input name="name" value="${attr(p.name)}">
            <div class="two">
              <div><label>Emoji</label><input name="emoji" value="${attr(p.emoji || '')}"></div>
              <div><label>Price</label><input name="price" value="${attr(p.price)}"></div>
            </div>
            <div class="two">
              <div><label>Stock (−1 = ∞)</label><input name="stock" value="${attr(p.stock)}"></div>
              <div><label>Status</label><select name="status">
                <option value="active" ${p.status === 'active' ? 'selected' : ''}>active</option>
                <option value="hidden" ${p.status === 'hidden' ? 'selected' : ''}>hidden</option>
              </select></div>
            </div>
            <div class="two">
              <div><label>Min qty</label><input name="minimum_quantity" value="${attr(p.minimum_quantity)}"></div>
              <div><label>Max qty</label><input name="maximum_quantity" value="${attr(p.maximum_quantity)}"></div>
            </div>
            <label>Category</label>
            <select name="category_id">${catOptions()}</select>
            <label>Description</label><textarea name="description">${esc(p.description || '')}</textarea>
            <label>Image URL</label><input name="image_url" value="${attr(p.image_url || '')}">
            <div class="row-actions" style="margin-top:10px">
              <button class="btn sm primary">Save</button>
            </div>
          </form>
          <form method="POST" action="/api/products/${attr(p.id)}" style="margin-top:8px">
            <input type="hidden" name="_csrf" value="${attr(csrf)}">
            <input type="hidden" name="op" value="delete">
            <button class="btn sm bad">🗑️ Delete product</button>
          </form>
        </details>
      </td>
    </tr>`
      )
      .join('')}
    </tbody></table></div>`;
}

function activityPage(data) {
  const { feed, errors } = data;
  const items = feed.length
    ? feed
        .map(
          (e) => `<div class="item">
        <b>${esc(e.event)}</b> <span class="mono">${esc(e.order_id)}</span>
        ${e.note ? `<div>${esc(e.note)}</div>` : ''}
        <small>${when(e.created_at)}${e.actor_id ? ` • by ${esc(e.actor_id)}` : ''}${
            e.username ? ` • @${esc(e.username)}` : ''
          }</small>
      </div>`
        )
        .join('')
    : '<div class="empty">No activity recorded yet.</div>';

  const errItems = errors.length
    ? errors
        .map(
          (e) => `<div class="item"><b>${esc(e.context || 'error')}</b>
          <div class="mono" style="white-space:pre-wrap;max-height:120px;overflow:auto">${esc(
            String(e.message || '').slice(0, 400)
          )}</div>
          <small>${when(e.created_at)}</small></div>`
        )
        .join('')
    : '<div class="empty">No errors logged.</div>';

  const body = `
  <div class="split">
    <div class="card">
      <h2>Order activity</h2>
      <div class="hint">Every status change, payment action and staff note, newest first.</div>
      <div class="timeline">${items}</div>
    </div>
    <div class="card">
      <h2>Errors</h2>
      <div class="hint">Captured bot errors (same feed as the error log channel).</div>
      <div class="timeline">${errItems}</div>
    </div>
  </div>`;
  return { title: 'Activity Log', active: '/activity', body };
}

function customerPage(data) {
  const { customer, orders, csrf, clientReady } = data;
  const body = `
  <div class="row-actions" style="margin-bottom:14px">
    <a class="btn sm" href="/customers">← Back to customers</a>
    ${
      customer.blacklisted
        ? `<span class="badge bad">🚫 BLOCKED — ${esc(customer.blacklist_reason || 'no reason')}</span>`
        : '<span class="badge ok">Allowed to order</span>'
    }
    ${
      clientReady
        ? '<span class="badge ok">Bot online</span>'
        : '<span class="badge warn">Bot offline — Discord notifications will not send</span>'
    }
  </div>

  <div class="grid g4">
    ${statCard('Customer', `@${esc(customer.username || '—')}`, `<span class="mono">${esc(customer.discord_user_id)}</span>`)}
    ${statCard('Lifetime value', money(customer.spent), `${num(customer.orders)} order(s) total`)}
    ${statCard('Completed', num(customer.completed), `${num(customer.open_orders)} open right now`)}
    ${statCard('Last order', esc(String(customer.last_order || '—').slice(0, 10)), `${num(customer.paid_orders)} verified payment(s)`)}
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Purchase history</h2>
    ${ordersTable(orders)}
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Controls</h2>
    <form method="POST" action="/api/customers/blacklist" class="inline">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <input type="hidden" name="discord_user_id" value="${attr(customer.discord_user_id)}">
      <input type="hidden" name="op" value="${customer.blacklisted ? 'remove' : 'add'}">
      ${
        customer.blacklisted
          ? '<button class="btn ok">✅ Unblock customer</button>'
          : '<input name="reason" placeholder="Reason (shown in logs)" style="min-width:220px"> <button class="btn bad">🚫 Block customer</button>'
      }
    </form>
    <div class="hint" style="margin-top:10px">Blocking prevents this user from opening new order tickets.</div>
  </div>`;
  return { title: `Customer @${customer.username || customer.discord_user_id}`, active: '/customers', body };
}

function settingsPage(data) {
  const { env, settings, keys, csrf, maintenance, botInfo } = data;
  const rows = keys
    .map(
      (k) => `
    <tr>
      <td class="mono">${esc(k.key)}</td>
      <td>
        <form method="POST" action="/api/settings" class="inline">
          <input type="hidden" name="_csrf" value="${attr(csrf)}">
          <input type="hidden" name="key" value="${attr(k.key)}">
          <input name="value" value="${attr(k.value)}" style="min-width:220px">
          <button class="btn sm">Save</button>
        </form>
      </td>
      <td class="right">
        <form method="POST" action="/api/settings" class="inline">
          <input type="hidden" name="_csrf" value="${attr(csrf)}">
          <input type="hidden" name="key" value="${attr(k.key)}">
          <input type="hidden" name="op" value="delete">
          <button class="btn sm bad">Delete</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const envRows = Object.entries(env)
    .map(
      ([k, v]) =>
        `<dt class="mono">${esc(k)}</dt><dd>${
          v === '' || v === null || v === undefined
            ? '<span class="badge warn">not set</span>'
            : `<span class="mono">${esc(v)}</span>`
        }</dd>`
    )
    .join('');

  const routes = [
    ['GET', '/orders', 'Order list with filters'],
    ['GET', '/orders/:id', 'Single order + all actions'],
    ['POST', '/api/orders/:id/action', 'approve · reject · reproof · deliver · cancel · refund · status · note · close'],
    ['GET', '/catalog', 'Categories + products'],
    ['POST', '/api/products', 'create product'],
    ['POST', '/api/products/:id', 'update · delete product'],
    ['POST', '/api/categories', 'create category'],
    ['POST', '/api/categories/:id', 'update · delete category'],
    ['GET', '/payments', 'Payment method configuration'],
    ['POST', '/api/payments', 'create payment method'],
    ['POST', '/api/payments/:key', 'save · toggle · delete method'],
    ['GET', '/emojis', 'Emoji studio + preview'],
    ['POST', '/api/emojis', 'set emoji override'],
    ['POST', '/api/emojis/reset', 'reset emoji key'],
    ['POST', '/api/emojis/rescan', 're-scan server emojis'],
    ['GET', '/customers', 'Customer ledger + blacklist'],
    ['POST', '/api/customers/blacklist', 'block · unblock customer'],
    ['GET', '/activity', 'Event + error feed'],
  ]
    .map(
      ([m, p, d]) =>
        `<dt><span class="badge info">${m}</span> <span class="mono">${esc(p)}</span></dt><dd>${esc(d)}</dd>`
    )
    .join('');

  const body = `
  <div class="grid g4">
    ${statCard('Bot', esc(botInfo.tag || 'offline'), esc(botInfo.status || 'not connected'))}
    ${statCard('Guilds', num(botInfo.guilds), 'Servers the bot serves')}
    ${statCard('Maintenance', maintenance ? '<span class="badge warn">ON</span>' : '<span class="badge ok">OFF</span>', 'Buying disabled while ON')}
    ${statCard('Database', 'SQLite', 'data/xshop.sqlite')}
  </div>

  <div class="split" style="margin-top:16px">
    <div class="card">
      <h2>Shop controls</h2>
      <form method="POST" action="/api/settings">
        <input type="hidden" name="_csrf" value="${attr(csrf)}">
        <input type="hidden" name="key" value="maintenance">
        <input type="hidden" name="value" value="${maintenance ? '0' : '1'}">
        <button class="btn ${maintenance ? 'ok' : 'warn'}" style="width:100%;justify-content:center">
          ${maintenance ? '✅ Turn maintenance OFF (open the shop)' : '🛠️ Turn maintenance ON (close the shop)'}
        </button>
      </form>
      <div class="hint" style="margin-top:10px">Same switch as <span class="mono">!maintenance on|off</span>.</div>
      <div class="row-actions" style="margin-top:14px">
        <a class="btn sm" href="/emojis">✨ Emoji Studio</a>
        <a class="btn sm" href="/payments">💳 Payments</a>
        <a class="btn sm" href="/catalog">🛍️ Catalog</a>
      </div>
    </div>
    <div class="card">
      <h2>Environment (.env — read-only)</h2>
      <dl class="kv">${envRows}</dl>
      <div class="hint">Secrets are never shown. Edit <span class="mono">.env</span> and restart the bot to change these.</div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Database settings</h2>
    <div class="hint">Live values the bot reads at runtime (emoji overrides, panel message id, maintenance…).</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Key</th><th>Value</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="empty">No settings yet.</td></tr>'}</tbody>
    </table></div>
    <form method="POST" action="/api/settings" style="margin-top:14px">
      <input type="hidden" name="_csrf" value="${attr(csrf)}">
      <div class="two">
        <div><label>New key</label><input name="key" placeholder="custom_key"></div>
        <div><label>Value</label><input name="value" placeholder="value"></div>
      </div>
      <button class="btn sm primary" style="margin-top:10px">Add / update setting</button>
    </form>
  </div>

  <div class="card" style="margin-top:16px">
    <h2>Dashboard API reference</h2>
    <div class="hint">Every mutating route requires a session and a CSRF token.</div>
    <dl class="kv">${routes}</dl>
  </div>`;
  return { title: 'Settings', active: '/settings', body };
}

module.exports = {
  esc,
  attr,
  money,
  num,
  when,
  statusBadge,
  payBadge,
  layout,
  flashBox,
  loginPage,
  statCard,
  barChart,
  miniBars,
  dashboardPage,
  ordersPage,
  orderPage,
  catalogPage,
  productsTable,
  paymentsPage,
  customersPage,
  emojisPage,
  activityPage,
  customerPage,
  settingsPage,
};








