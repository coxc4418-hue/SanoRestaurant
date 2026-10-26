// SANO Restaurant — Pedidos abiertos y ventas
import { store, ORDER_TYPES } from '../store.js';
import { cancelOrder, voidSale, lineLabel } from '../ops.js';
import { openCharge } from '../charge.js';
import { requirePin } from '../auth.js';
import { esc, usd, bs, toast, openModal, emptyState, fmtAgo, fmtTime, fmtDateTime, promptDialog, todayKey, fromKey, startOfDay, endOfDay, methodLabel, normalize, debounce } from '../utils.js';
import { icon } from '../icons.js';
import { printReceipt } from '../shared.js';

const TYPE_BADGE = { mesa: 'badge-brand', llevar: 'badge-info', delivery: 'badge-violet' };

export function mount(el, { navigate }) {
  let tab = 'open';
  let day = todayKey();
  let sales = null;
  let q = '';

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Pedidos</h1><p class="view-sub">Pedidos por cobrar y ventas registradas.</p></div>
      <div class="view-actions"><button class="btn btn-primary" id="o-new">${icon('plus')} Nuevo pedido</button></div>
    </div>
    <div class="tabs" id="o-tabs">
      <button data-tab="open">Abiertos <span class="badge badge-brand" id="o-count">0</span></button>
      <button data-tab="sales">Ventas</button>
    </div>
    <div id="o-body"></div>`;
  const $ = (s) => el.querySelector(s);

  function render() {
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#o-count').textContent = store.orders.length;
    if (tab === 'open') renderOpen(); else renderSales();
  }

  function renderOpen() {
    const list = store.orders;
    $('#o-body').innerHTML = list.length ? `<div class="card card-flush"><div class="table-wrap"><table class="table">
      <thead><tr><th>#</th><th>Pedido</th><th class="hide-sm">Productos</th><th>Tiempo</th><th class="r">Total</th><th class="r">Acciones</th></tr></thead>
      <tbody>${list.map((o) => `<tr>
        <td><b style="font-size:17px">#${esc(o.orderNo)}</b></td>
        <td><span class="badge ${TYPE_BADGE[o.type]}">${icon(ORDER_TYPES[o.type]?.icon || 'bag')} ${o.type === 'mesa' ? esc(o.tableName) : ORDER_TYPES[o.type]?.label}</span>
          ${o.customerName ? `<div class="t-sub">${esc(o.customerName)}${o.customerPhone ? ' · ' + esc(o.customerPhone) : ''}</div>` : ''}
          ${o.address ? `<div class="t-sub">${icon('truck')} ${esc(o.address)}</div>` : ''}</td>
        <td class="hide-sm small">${(o.items || []).map((l) => `${l.qty}× ${esc(lineLabel(l))}`).join(', ')}</td>
        <td class="nowrap">${fmtAgo(o.createdAt)}</td>
        <td class="r num"><b>${usd(o.total || 0)}</b><div class="t-sub text-bs">${bs((o.total || 0) * store.rate)}</div></td>
        <td class="r nowrap">
          <button class="btn btn-ghost btn-icon btn-sm" data-edit="${o.id}" title="Agregar o editar">${icon('edit')}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-cancel="${o.id}" title="Cancelar">${icon('trash')}</button>
          <button class="btn btn-primary btn-sm" data-pay="${o.id}">${icon('dollar')} Cobrar</button>
        </td></tr>`).join('')}</tbody></table></div></div>`
      : `<div class="card">${emptyState('clipboard', 'No hay pedidos abiertos', 'Los pedidos de mesa y los que guardes para “cobrar luego” aparecen aquí.')}</div>`;
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => navigate('vender', { params: { orderId: b.dataset.edit } }));
    el.querySelectorAll('[data-pay]').forEach((b) => b.onclick = () => {
      const o = store.order(b.dataset.pay);
      openCharge({ order: o, type: o.type, tableId: o.tableId, tableName: o.tableName, lines: o.items || [], customer: o.customerId ? store.customer(o.customerId) || { id: o.customerId, name: o.customerName } : null, waiter: o.waiter, people: o.people, address: o.address, note: o.note, deliveryFee: o.deliveryFee });
    });
    el.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
      const o = store.order(b.dataset.cancel);
      if (!(await requirePin('Cancelar un pedido'))) return;
      const reason = await promptDialog({ title: `Cancelar pedido #${o.orderNo}`, label: 'Motivo (opcional)', confirmText: 'Cancelar pedido' });
      if (reason === null) return;
      await cancelOrder(o, reason); toast('Pedido cancelado', 'warning');
    });
  }

  async function loadSales() {
    if (day === todayKey()) { sales = store.recentSales.filter((s) => s.dayKey === day); return; }
    sales = null; renderSales();
    const d = fromKey(day);
    sales = (await store.salesBetween(startOfDay(d).toISOString(), endOfDay(d).toISOString())).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  function renderSales() {
    if (!$('#s-day')) {
      $('#o-body').innerHTML = `<div class="card card-flush">
        <div class="toolbar"><input type="date" class="input" id="s-day" value="${day}" style="max-width:180px"><label class="search">${icon('search')}<input id="s-q" placeholder="Buscar por número, cliente o producto…"></label><div id="s-sum" class="small muted"></div></div>
        <div id="s-list"></div></div>`;
      $('#s-day').onchange = async (e) => { day = e.target.value || todayKey(); await loadSales(); renderSales(); };
      $('#s-q').oninput = debounce((e) => { q = e.target.value; renderSales(); }, 120);
    }
    if (!sales) { $('#s-list').innerHTML = '<div class="empty"><div class="spinner"></div></div>'; return; }
    const nq = normalize(q);
    const list = sales.filter((s) => !nq || normalize(`${s.number} #${s.orderNo} ${s.customerName} ${s.tableName} ${(s.items || []).map((i) => i.name).join(' ')}`).includes(nq));
    const ok = list.filter((s) => s.status !== 'voided');
    $('#s-sum').innerHTML = `${ok.length} venta(s) · <b>${usd(ok.reduce((a, s) => a + (s.total || 0), 0))}</b>`;
    $('#s-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Hora</th><th>#</th><th>Tipo</th><th class="hide-sm">Cliente</th><th class="hide-sm">Pago</th><th class="r">Total</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr style="${s.status === 'voided' ? 'opacity:.55' : ''}">
        <td>${fmtTime(s.date)}</td><td><b>#${esc(s.orderNo)}</b><div class="t-sub">${esc(s.number)}</div></td>
        <td><span class="badge ${TYPE_BADGE[s.type] || 'badge-neutral'}">${esc(s.type === 'mesa' ? s.tableName : s.typeLabel || '')}</span>${s.status === 'voided' ? ' <span class="badge badge-danger">Anulada</span>' : ''}</td>
        <td class="hide-sm">${esc(s.customerName || 'Mostrador')}</td>
        <td class="hide-sm small">${(s.payments || []).map((p) => esc(methodLabel(p.method))).join(' + ')}</td>
        <td class="r num"><b>${usd(s.total)}</b><div class="t-sub text-bs">${bs(s.totalBs)}</div></td>
        <td class="r"><button class="btn btn-ghost btn-sm" data-view="${s.id}">${icon('eye')} Ver</button></td></tr>`).join('')}
      </tbody></table></div>` : `<div style="padding:10px">${emptyState('receipt', 'Sin ventas', 'No hay ventas registradas en esta fecha.')}</div>`;
    el.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => saleDetail(sales.find((s) => s.id === b.dataset.view)));
  }

  function saleDetail(s) {
    const m = openModal({
      title: `Venta #${esc(s.orderNo)} · ${esc(s.number)}`, sub: `${fmtDateTime(s.date)} · ${esc(s.typeLabel || '')}${s.tableName ? ' · ' + esc(s.tableName) : ''}`,
      body: `<div class="stack">
        ${s.status === 'voided' ? `<div class="pay-status due"><span>Anulada ${s.voidReason ? '· ' + esc(s.voidReason) : ''}</span><span>${fmtDateTime(s.voidedAt)}</span></div>` : ''}
        <div class="summary-box">
          ${(s.items || []).map((l) => `<div class="summary-row"><span>${l.qty} × ${esc(lineLabel(l))}${l.extras?.length ? `<br><small class="muted">+ ${l.extras.map((e) => esc(e.name)).join(', ')}</small>` : ''}</span><b class="num">${usd(l.total)}</b></div>`).join('')}
          ${s.discount ? `<div class="summary-row"><span>Descuento</span><span>−${usd(s.discount)}</span></div>` : ''}
          ${s.delivery ? `<div class="summary-row"><span>Delivery</span><span>${usd(s.delivery)}</span></div>` : ''}
          ${s.tip ? `<div class="summary-row"><span>Propina</span><span>${usd(s.tip)}</span></div>` : ''}
          <div class="summary-row total"><span>Total</span><span>${usd(s.total)} <small class="text-bs">${bs(s.totalBs)}</small></span></div>
        </div>
        <div class="small muted">Pagos: ${(s.payments || []).map((p) => `${esc(methodLabel(p.method))} ${p.currency === 'BS' ? bs(p.amount) : usd(p.amount)}`).join(' · ')}${s.changeUSD ? ` · Vuelto ${s.changeCurrency === 'BS' ? bs(s.changeUSD * s.rate) : usd(s.changeUSD)}` : ''}</div>
        ${s.consumption?.length ? `<details><summary class="small bold" style="cursor:pointer">Insumos descontados (${s.consumption.length})</summary><div class="small muted mt">${s.consumption.map((c) => `${esc(c.name)}: ${c.qty} ${esc(c.unit)}`).join(' · ')}</div></details>` : ''}
        <div class="small muted">Costo de insumos: ${usd(s.cost || 0)} · Ganancia bruta: <b>${usd((s.total || 0) - (s.cost || 0) - (s.tip || 0))}</b></div>
      </div>`,
      footer: `${s.status !== 'voided' ? `<button class="btn btn-danger-soft" data-void style="margin-right:auto">${icon('x')} Anular</button>` : ''}<button class="btn btn-secondary" data-pr>${icon('print')} Recibo</button><button class="btn btn-primary" data-close>Cerrar</button>`
    });
    m.el.querySelector('[data-pr]').onclick = () => printReceipt(s);
    const v = m.el.querySelector('[data-void]');
    if (v) v.onclick = async () => {
      if (!(await requirePin('Anular una venta'))) return;
      const reason = await promptDialog({ title: 'Anular venta', label: 'Motivo', confirmText: 'Anular venta' });
      if (reason === null) return;
      try {
        const r = await voidSale(s, reason);
        s.status = 'voided';
        m.close();
        toast(r.cashReverted ? 'Venta anulada: insumos devueltos y caja ajustada' : 'Venta anulada: insumos devueltos (no hay caja abierta para ajustar)', 'warning', 5000);
        if (day !== todayKey()) renderSales();
      } catch (e) { toast(e.message, 'danger'); }
    };
  }

  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = async () => {
    tab = b.dataset.tab;
    if (tab === 'sales') { $('#o-body').innerHTML = ''; await loadSales(); }
    render();
  });
  $('#o-new').onclick = () => navigate('vender', { params: { type: 'llevar' } });
  render();
  const off = store.on('*', (evt) => {
    if (evt === 'orders') { $('#o-count').textContent = store.orders.length; if (tab === 'open') renderOpen(); }
    if (evt === 'sales' && tab === 'sales' && day === todayKey()) { sales = store.recentSales.filter((s) => s.dayKey === day); renderSales(); }
  });
  const timer = setInterval(() => { if (tab === 'open') renderOpen(); }, 60000);
  return () => { off(); clearInterval(timer); };
}
