// SANO Restaurant — Inicio (resumen del día y alertas)
import { store, ORDER_TYPES } from '../store.js';
import { esc, usd, bs, num, fmtLongDate, todayKey, dayKey, addDays, emptyState } from '../utils.js';
import { icon } from '../icons.js';
import { openRateModal, stockText } from '../shared.js';
import { isStandalone, platform, bindInstallButtons } from '../install.js';

/** Barras verticales de una serie (ventas por día) con tooltip */
export function barChart(rows, { valueFmt = usd } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 0.01);
  return `<div class="bars" role="img" aria-label="Ventas por día">${rows.map((r) => `
    <div class="bar ${r.today ? 'today' : ''}" title="${esc(r.label)}: ${esc(valueFmt(r.value))}">
      <small class="num" style="font-size:11px;color:var(--muted)">${r.value > 0 && (r.today || r.value === max) ? esc(valueFmt(r.value)) : ''}</small>
      <i style="height:${Math.max(1.5, r.value / max * 100)}%"></i><span>${esc(r.short)}</span></div>`).join('')}</div>`;
}

function showInstall() {
  if (isStandalone()) return false;
  try { return localStorage.getItem('sr_install_hide') !== '1'; } catch (_) { return true; }
}

export function mount(el, { navigate }) {
  el.innerHTML = '<div id="d-root"></div>';
  const $ = (s) => el.querySelector(s);

  function render() {
    const today = todayKey();
    const sales = store.recentSales.filter((s) => s.status !== 'voided');
    const todays = sales.filter((s) => s.dayKey === today);
    const total = todays.reduce((a, s) => a + (s.total || 0), 0);
    const cost = todays.reduce((a, s) => a + (s.cost || 0), 0);
    const tips = todays.reduce((a, s) => a + (s.tip || 0), 0);
    const profit = total - cost - tips;
    const avg = todays.length ? total / todays.length : 0;
    const openOrders = store.orders.length;
    const openValue = store.orders.reduce((a, o) => a + (o.total || 0), 0);
    const busyTables = store.orders.filter((o) => o.type === 'mesa').length;

    // Últimos 7 días
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = addDays(new Date(), i - 6); const k = dayKey(d);
      return { label: d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric' }), short: i === 6 ? 'Hoy' : d.toLocaleDateString('es-VE', { weekday: 'short' }).replace('.', ''), today: i === 6, value: sales.filter((s) => s.dayKey === k).reduce((a, s) => a + (s.total || 0), 0) };
    });
    const week = days.reduce((a, d) => a + d.value, 0);

    // Más vendidos hoy
    const top = {};
    todays.forEach((s) => (s.items || []).forEach((i) => { const k = i.name + (i.variantName ? ' · ' + i.variantName : ''); top[k] = top[k] || { q: 0, v: 0, e: i.emoji }; top[k].q += i.qty; top[k].v += i.total; }));
    const topList = Object.entries(top).sort((a, b) => b[1].q - a[1].q).slice(0, 6);
    const topMax = topList[0]?.[1].q || 1;

    const byType = Object.keys(ORDER_TYPES).map((k) => ({ k, v: todays.filter((s) => s.type === k).reduce((a, s) => a + s.total, 0), n: todays.filter((s) => s.type === k).length }));

    // Alertas
    const alerts = [];
    if (!store.openShift) alerts.push({ tone: 'warning', icon: 'wallet', text: 'La caja está cerrada. Ábrela para empezar a cobrar.', btn: 'Abrir caja', go: () => navigate('caja') });
    const rateDay = store.settings.rateUpdatedAt ? dayKey(new Date(store.settings.rateUpdatedAt)) : '';
    if (!(store.rate > 0) || rateDay !== today) alerts.push({ tone: 'info', icon: 'refresh', text: store.rate > 0 ? `La tasa (Bs ${num(store.rate)}) no se ha actualizado hoy.` : 'Configura la tasa del día.', btn: 'Actualizar tasa', go: openRateModal });
    const pend = store.tickets.filter((t) => t.status === 'pendiente').length;
    if (pend) alerts.push({ tone: 'brand', icon: 'chef', text: `${pend} comanda(s) esperando en cocina.`, btn: 'Ver cocina', go: () => navigate('cocina') });
    if (!store.products.length) alerts.push({ tone: 'brand', icon: 'burger', text: 'Crea tu menú con sus recetas para empezar a vender.', btn: 'Crear menú', go: () => navigate('menu') });
    const low = store.lowIngredients;

    const hour = new Date().getHours();
    const hi = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

    $('#d-root').innerHTML = `
      <div class="view-header">
        <div><h1 class="view-title">${hi} 👋</h1><p class="view-sub">${fmtLongDate()} · ${esc(store.businessName)}</p></div>
        <div class="view-actions"><button class="btn btn-secondary" id="d-rate">${icon('refresh')} Tasa: Bs ${num(store.rate)}</button><button class="btn btn-primary" id="d-sell">${icon('cart')} Vender</button></div>
      </div>
      <div class="quick">
        <button data-go="vender" data-p="llevar"><span class="kpi-icon tone-brand">${icon('bag')}</span><span>Para llevar<small>Venta rápida</small></span></button>
        <button data-go="mesas"><span class="kpi-icon tone-success">${icon('table')}</span><span>Mesas<small>${busyTables} ocupada(s)</small></span></button>
        <button data-go="vender" data-p="delivery"><span class="kpi-icon tone-violet">${icon('truck')}</span><span>Delivery<small>Pedido a domicilio</small></span></button>
        <button data-go="inventario"><span class="kpi-icon tone-warning">${icon('box')}</span><span>Inventario<small>${low.length ? low.length + ' alerta(s)' : 'Todo en orden'}</small></span></button>
      </div>
      <div class="kpis">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ventas de hoy</span><span class="kpi-icon tone-success">${icon('trend')}</span></div><div class="kpi-value">${usd(total)}</div><div class="kpi-sub text-bs">${bs(total * store.rate)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Pedidos de hoy</span><span class="kpi-icon tone-brand">${icon('receipt')}</span></div><div class="kpi-value">${todays.length}</div><div class="kpi-sub">Ticket promedio ${usd(avg)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ganancia bruta</span><span class="kpi-icon tone-info">${icon('dollar')}</span></div><div class="kpi-value">${usd(profit)}</div><div class="kpi-sub">Ventas − costo de insumos</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Por cobrar</span><span class="kpi-icon tone-warning">${icon('clock')}</span></div><div class="kpi-value">${usd(openValue)}</div><div class="kpi-sub">${openOrders} pedido(s) abiertos</div></div>
      </div>
      ${showInstall() ? `<div class="install-card mb"><img src="/assets/icon-192.png" alt=""><div class="grow"><b>Instala SANO Restaurant en este ${platform() === 'desktop' ? 'computador' : 'teléfono'}</b><span>Ábrelo con un toque desde tu ${platform() === 'desktop' ? 'escritorio' : 'pantalla de inicio'}, en su propia ventana.</span></div><button class="btn btn-primary btn-sm" data-install>${icon('install')} Instalar</button><button class="btn btn-ghost btn-icon btn-sm" id="d-inst-x" aria-label="Ocultar">${icon('x')}</button></div>` : ''}
      ${alerts.length ? `<div class="stack-sm mb">${alerts.map((a, i) => `<div class="card between row-wrap" style="padding:12px 16px"><div class="row"><span class="kpi-icon tone-${a.tone}" style="width:32px;height:32px">${icon(a.icon)}</span><span class="bold">${esc(a.text)}</span></div><button class="btn btn-secondary btn-sm" data-alert="${i}">${a.btn}</button></div>`).join('')}</div>` : ''}
      <div class="grid-main">
        <div class="stack">
          <div class="card"><div class="card-head"><div class="card-title">${icon('chart')} Ventas de los últimos 7 días</div><span class="small muted">Total ${usd(week)}</span></div>${barChart(days)}</div>
          <div class="card"><div class="card-head"><div class="card-title">${icon('flame')} Lo más vendido hoy</div></div>
            ${topList.length ? topList.map(([n, d]) => `<div class="hbar" title="${esc(n)}: ${num(d.q, 0)} vendidos · ${usd(d.v)}"><span class="ellipsis">${esc(d.e || '')} ${esc(n)}</span><div class="track"><i style="width:${d.q / topMax * 100}%"></i></div><b class="num">${num(d.q, 0)}</b></div>`).join('') : emptyState('flame', 'Aún no hay ventas hoy', 'Lo más vendido aparecerá aquí.')}</div>
        </div>
        <div class="stack">
          <div class="card"><div class="card-head"><div class="card-title">${icon('bell')} Alertas de stock</div>${low.length ? `<span class="badge badge-danger">${low.length}</span>` : ''}</div>
            ${low.length ? `<div class="list">${low.slice(0, 7).map((i) => `<div class="list-item"><span class="kpi-icon ${(Number(i.stock) || 0) <= 0 ? 'tone-danger' : 'tone-warning'}" style="width:30px;height:30px">${icon('alert')}</span><div class="grow"><div class="t-name">${esc(i.name)}</div><div class="t-sub">Quedan ${stockText(i)} · mínimo ${num(i.minStock || 0, 0)}</div></div></div>`).join('')}</div>
              <button class="btn btn-soft btn-block mt" id="d-shop">${icon('clipboard')} Ver lista de compras</button>` : emptyState('check', 'Inventario en orden', 'Ningún insumo está por debajo de su mínimo.')}</div>
          <div class="card"><div class="card-head"><div class="card-title">${icon('layers')} Hoy por tipo de pedido</div></div>
            ${byType.map((t) => `<div class="between" style="padding:8px 0;border-bottom:1px dashed var(--border)"><span class="row">${icon(ORDER_TYPES[t.k].icon)} ${ORDER_TYPES[t.k].label} <span class="t-sub">(${t.n})</span></span><b class="num">${usd(t.v)}</b></div>`).join('')}</div>
        </div>
      </div>`;
    el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => navigate(b.dataset.go, b.dataset.p ? { params: { type: b.dataset.p } } : {}));
    el.querySelectorAll('[data-alert]').forEach((b) => b.onclick = () => alerts[+b.dataset.alert].go());
    $('#d-rate').onclick = openRateModal;
    bindInstallButtons(el);
    if ($('#d-inst-x')) $('#d-inst-x').onclick = () => { try { localStorage.setItem('sr_install_hide', '1'); } catch (_) {} render(); };
    $('#d-sell').onclick = () => navigate('vender');
    if ($('#d-shop')) $('#d-shop').onclick = () => navigate('inventario');
  }
  render();
  const off = store.on('*', (evt) => { if (['sales', 'orders', 'ingredients', 'tickets', 'shift', 'settings', 'rate', 'products'].includes(evt)) render(); });
  return off;
}

