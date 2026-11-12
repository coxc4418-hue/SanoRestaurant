// SanoRestaurant — Búsqueda global (Ctrl + K): secciones, productos, clientes, mesas y pedidos abiertos
import { store } from '../store.js';
import { openModal, esc, usd, normalize, debounce, initials, colorFor } from '../utils.js';
import { icon } from '../icons.js';

const SECTIONS = [
  ['vender', 'Vender', 'punto de venta cobrar pos para llevar', 'cart'],
  ['mesas', 'Mesas', 'salon comedor', 'grid'],
  ['pedidos', 'Pedidos', 'ordenes comandas delivery', 'receipt'],
  ['cocina', 'Cocina', 'comandas preparacion kds', 'flame'],
  ['menu', 'Menú y recetas', 'platos productos carta recetas', 'burger'],
  ['inventario', 'Inventario', 'ingredientes insumos stock', 'box'],
  ['clientes', 'Clientes', 'compradores contactos', 'users'],
  ['caja', 'Caja', 'turno apertura cierre gastos', 'wallet'],
  ['reportes', 'Reportes', 'ventas ganancias estadisticas', 'trend'],
  ['ajustes', 'Configuración', 'ajustes tasa pin seguridad', 'settings'],
  ['inicio', 'Inicio', 'tablero resumen', 'home']
];

/** Abre una sección y escribe el texto en su buscador para dejar el resultado filtrado. */
async function goFiltered(route, text) {
  const { navigate } = await import('../main.js');
  await navigate(route, { force: true });
  setTimeout(() => {
    const inp = document.querySelector('#view input[type="search"], #view .search input, #view input[placeholder^="Buscar"]');
    if (inp && text) { inp.value = text; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.focus(); }
  }, 250);
}

export function openSearch() {
  if (document.querySelector('.search-modal')) return;
  const m = openModal({
    size: 'lg',
    body: `<label class="search search-big">${icon('search')}<input data-q placeholder="Plato, cliente, teléfono, mesa, pedido abierto o sección…" autofocus autocomplete="off"><kbd class="hide-sm">Esc</kbd></label><div data-res class="sres"></div>`
  });
  m.el.querySelector('.modal')?.classList.add('search-modal');
  const input = m.el.querySelector('[data-q]');
  const res = m.el.querySelector('[data-res]');
  const price = (p) => p.price ?? (Array.isArray(p.prices) ? (p.prices[0]?.price ?? p.prices[0]) : 0) ?? 0;

  function run() {
    const t = normalize(input.value.trim());
    if (!t) { res.innerHTML = hint(); bind(); return; }
    const secs = SECTIONS.filter(([, title, words]) => normalize(`${title} ${words}`).includes(t)).sort((a, b) => (normalize(b[1]).includes(t) ? 1 : 0) - (normalize(a[1]).includes(t) ? 1 : 0)).slice(0, 4);
    const prods = (store.products || []).filter((p) => normalize(`${p.name} ${p.barcode || ''} ${p.code || ''} ${p.category || ''}`).includes(t)).slice(0, 6);
    const custs = (store.customers || []).filter((c) => normalize(`${c.name} ${c.phone || ''} ${c.idDoc || ''}`).includes(t)).slice(0, 5);
    const tables = (store.tables || []).filter((x) => normalize(x.name || '').includes(t)).slice(0, 4);
    const orders = (store.orders || []).filter((o) => normalize(`${o.number || ''} ${o.customerName || ''} ${o.tableName || ''}`).includes(t)).slice(0, 5);
    const any = secs.length || prods.length || custs.length || tables.length || orders.length;
    res.innerHTML = any ? `
      ${secs.length ? `<div class="section-title">Secciones</div>${secs.map(([r, title, , ic]) => `<button class="sitem" data-s="${r}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(ic)}</span><span class="grow"><b>${esc(title)}</b><small>Ir a la sección</small></span>${icon('arrowRight')}</button>`).join('')}` : ''}
      ${orders.length ? `<div class="section-title">Pedidos abiertos</div>${orders.map((o) => `<button class="sitem" data-o="${o.id}"><span class="kpi-icon tone-warning" style="width:36px;height:36px">${icon('receipt')}</span><span class="grow"><b>${esc(o.number || o.tableName || 'Pedido')}${o.tableName && o.number ? ' · ' + esc(o.tableName) : ''}</b><small>${esc(o.customerName || '')} · ${usd(o.total || 0)}</small></span>${icon('arrowRight')}</button>`).join('')}` : ''}
      ${tables.length ? `<div class="section-title">Mesas</div>${tables.map((x) => `<button class="sitem" data-s="mesas"><span class="kpi-icon tone-success" style="width:36px;height:36px">${icon('grid')}</span><span class="grow"><b>${esc(x.name)}</b><small>Ver mesas</small></span>${icon('arrowRight')}</button>`).join('')}` : ''}
      ${prods.length ? `<div class="section-title">Menú</div>${prods.map((p) => `<button class="sitem" data-p="${esc(p.name)}"><span class="kpi-icon tone-info" style="width:36px;height:36px">${icon('box')}</span><span class="grow"><b>${esc(p.name)}</b><small>${esc(p.category || '')}${p.stock != null ? ' · stock ' + esc(String(p.stock)) : ''} · ${usd(price(p))}</small></span>${icon('arrowRight')}</button>`).join('')}` : ''}
      ${custs.length ? `<div class="section-title">Clientes</div>${custs.map((c) => `<button class="sitem" data-c="${esc(c.name)}"><span class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</span><span class="grow"><b>${esc(c.name)}</b><small>${esc(c.phone || c.idDoc || '')}</small></span>${icon('arrowRight')}</button>`).join('')}` : ''}`
      : `<div class="empty" style="padding:28px;text-align:center">${icon('search')}<p><b>Sin resultados</b></p><p class="muted">Prueba con otro nombre, código o teléfono.</p></div>`;
    bind();
  }

  function hint() {
    return `<div class="section-title">Ir a</div>${SECTIONS.slice(0, 6).map(([r, title, , ic]) => `<button class="sitem" data-s="${r}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(ic)}</span><span class="grow"><b>${esc(title)}</b></span>${icon('arrowRight')}</button>`).join('')}`;
  }

  function bind() {
    res.querySelectorAll('[data-s]').forEach((b) => b.onclick = async () => { m.close(); (await import('../main.js')).navigate(b.dataset.s); });
    res.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { m.close(); goFiltered('menu', b.dataset.p); });
    res.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { m.close(); goFiltered('clientes', b.dataset.c); });
    res.querySelectorAll('[data-o]').forEach((b) => b.onclick = async () => { m.close(); (await import('../main.js')).navigate('vender', { params: { orderId: b.dataset.o } }); });
  }

  input.oninput = debounce(run, 120);
  input.onkeydown = (e) => { if (e.key === 'Enter') res.querySelector('.sitem')?.click(); };
  res.innerHTML = hint(); bind();
}
