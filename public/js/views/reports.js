// SANO Restaurant — Reportes
import { store, ORDER_TYPES, unitShort } from '../store.js';
import { esc, usd, bs, num, emptyState, startOfDay, endOfDay, addDays, dayKey, fromKey, todayKey, fmtDate, PAY_METHODS, methodLabel, toCSV, download, qtyFmt, round4 } from '../utils.js';
import { icon } from '../icons.js';
import { printDoc } from '../shared.js';
import { barChart } from './dashboard.js';

const PRESETS = { today: 'Hoy', yesterday: 'Ayer', week: '7 días', month: 'Este mes', lastmonth: 'Mes pasado', custom: 'Personalizado' };

function range(preset, from, to) {
  const now = new Date();
  if (preset === 'today') return [startOfDay(now), endOfDay(now)];
  if (preset === 'yesterday') { const d = addDays(now, -1); return [startOfDay(d), endOfDay(d)]; }
  if (preset === 'week') return [startOfDay(addDays(now, -6)), endOfDay(now)];
  if (preset === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)];
  if (preset === 'lastmonth') return [new Date(now.getFullYear(), now.getMonth() - 1, 1), endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))];
  return [startOfDay(fromKey(from)), endOfDay(fromKey(to))];
}

export function mount(el) {
  let preset = 'today';
  let from = todayKey(); let to = todayKey();
  let tab = 'summary';
  let data = null;
  let token = 0;

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Reportes</h1><p class="view-sub" id="r-sub"></p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="r-csv">${icon('download')} Excel (CSV)</button><button class="btn btn-secondary" id="r-print">${icon('print')} Imprimir</button></div>
    </div>
    <div class="row row-wrap mb">
      <div class="chips" id="r-presets">${Object.entries(PRESETS).map(([k, v]) => `<button class="chip" data-pr="${k}">${v}</button>`).join('')}</div>
      <div class="row" id="r-custom" hidden><input type="date" class="input input-sm" id="r-from" value="${from}"><span class="muted">a</span><input type="date" class="input input-sm" id="r-to" value="${to}"></div>
    </div>
    <div class="tabs"><button data-tab="summary">Resumen</button><button data-tab="products">Productos</button><button data-tab="ingredients">Insumos consumidos</button><button data-tab="expenses">Gastos</button></div>
    <div id="r-body"></div>`;
  const $ = (s) => el.querySelector(s);

  async function load() {
    const t = ++token;
    const [a, b] = range(preset, from, to);
    $('#r-sub').textContent = `${fmtDate(a.toISOString())}${dayKey(a) !== dayKey(b) ? ' al ' + fmtDate(b.toISOString()) : ''}`;
    $('#r-body').innerHTML = '<div class="card"><div class="empty"><div class="spinner"></div></div></div>';
    const [sales, moves] = await Promise.all([
      store.salesBetween(a.toISOString(), b.toISOString()).catch(() => []),
      store.listBetween('cash_movements', a.toISOString(), b.toISOString()).catch(() => [])
    ]);
    if (t !== token) return;
    data = compute(sales, moves, a, b);
    render();
  }

  function compute(all, moves, a, b) {
    const sales = all.filter((s) => s.status !== 'voided');
    const voided = all.filter((s) => s.status === 'voided');
    const sum = (f) => sales.reduce((acc, s) => acc + (Number(f(s)) || 0), 0);
    const total = sum((s) => s.total), cost = sum((s) => s.cost), tips = sum((s) => s.tip);
    const r = {
      sales, voided, total, cost, tips, count: sales.length,
      discount: sum((s) => s.discount), service: sum((s) => s.service), delivery: sum((s) => s.delivery),
      totalBs: sum((s) => s.totalBs)
    };
    r.profit = total - cost - tips;
    r.margin = total > 0 ? r.profit / (total - tips) * 100 : 0;
    r.avg = r.count ? total / r.count : 0;
    // Por día
    const days = Math.min(62, Math.round((endOfDay(b) - startOfDay(a)) / 864e5) + 0);
    r.byDay = Array.from({ length: Math.max(1, days) }, (_, i) => {
      const d = addDays(startOfDay(a), i); const k = dayKey(d);
      return { label: fmtDate(k), short: days > 14 ? String(d.getDate()) : d.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric' }).replace('.', ''), today: k === todayKey(), value: sales.filter((s) => s.dayKey === k).reduce((acc, s) => acc + s.total, 0) };
    });
    // Por hora
    r.byHour = Array.from({ length: 24 }, (_, h) => ({ label: `${h}:00`, short: String(h), value: sales.filter((s) => new Date(s.date).getHours() === h).reduce((acc, s) => acc + s.total, 0) }));
    const firstH = r.byHour.findIndex((x) => x.value > 0); const lastH = 23 - [...r.byHour].reverse().findIndex((x) => x.value > 0);
    r.byHour = firstH >= 0 ? r.byHour.slice(Math.max(0, firstH - 1), Math.min(24, lastH + 2)) : [];
    // Pagos
    r.byMethod = {};
    sales.forEach((s) => (s.payments || []).forEach((p) => { r.byMethod[p.method] = r.byMethod[p.method] || { usd: 0, orig: 0, cur: p.currency }; r.byMethod[p.method].usd += p.usd || 0; r.byMethod[p.method].orig += p.amount || 0; }));
    // Cambio entregado se descuenta del efectivo
    r.byType = Object.keys(ORDER_TYPES).map((k) => ({ k, n: sales.filter((s) => s.type === k).length, v: sales.filter((s) => s.type === k).reduce((acc, s) => acc + s.total, 0) }));
    // Productos
    const prods = {};
    sales.forEach((s) => {
      const factor = s.subtotal > 0 ? (s.subtotal - (s.discount || 0)) / s.subtotal : 1;
      const lineCostShare = (s.items || []).reduce((acc, i) => acc + i.total, 0) || 1;
      (s.items || []).forEach((i) => {
        const k = i.name + (i.variantName ? ' · ' + i.variantName : '');
        const p = prods[k] ||= { name: k, category: i.category || '', qty: 0, revenue: 0, cost: 0 };
        p.qty += i.qty; p.revenue += i.total * factor; p.cost += (s.cost || 0) * (i.total / lineCostShare);
      });
    });
    r.products = Object.values(prods).sort((x, y) => y.revenue - x.revenue);
    const cats = {};
    r.products.forEach((p) => { const c = cats[p.category || 'Sin categoría'] ||= { name: p.category || 'Sin categoría', qty: 0, revenue: 0 }; c.qty += p.qty; c.revenue += p.revenue; });
    r.categories = Object.values(cats).sort((x, y) => y.revenue - x.revenue);
    // Insumos
    const ings = {};
    sales.forEach((s) => (s.consumption || []).forEach((c) => { const g = ings[c.ingredientId] ||= { name: c.name, unit: c.unit, qty: 0, cost: 0 }; g.qty += c.qty; g.cost += c.cost || 0; }));
    r.ingredients = Object.values(ings).sort((x, y) => y.cost - x.cost);
    // Gastos
    r.expenses = moves.filter((m) => m.type === 'expense').sort((x, y) => (y.date || '').localeCompare(x.date || ''));
    r.expensesUSD = r.expenses.reduce((acc, m) => acc + (m.currency === 'BS' ? m.amount / (m.rate || store.rate || 1) : m.amount), 0);
    return r;
  }

  function render() {
    el.querySelectorAll('[data-pr]').forEach((b) => b.classList.toggle('on', b.dataset.pr === preset));
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    $('#r-custom').hidden = preset !== 'custom';
    if (!data) return;
    const d = data;
    if (tab === 'summary') {
      const maxM = Math.max(...Object.values(d.byMethod).map((x) => x.usd), 0.01);
      $('#r-body').innerHTML = `
        <div class="kpis">
          <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ventas</span><span class="kpi-icon tone-success">${icon('trend')}</span></div><div class="kpi-value">${usd(d.total)}</div><div class="kpi-sub text-bs">${bs(d.totalBs)}</div></div>
          <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Pedidos</span><span class="kpi-icon tone-brand">${icon('receipt')}</span></div><div class="kpi-value">${d.count}</div><div class="kpi-sub">Promedio ${usd(d.avg)}${d.voided.length ? ` · ${d.voided.length} anulada(s)` : ''}</div></div>
          <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Costo de insumos</span><span class="kpi-icon tone-warning">${icon('box')}</span></div><div class="kpi-value">${usd(d.cost)}</div><div class="kpi-sub">según recetas</div></div>
          <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ganancia bruta</span><span class="kpi-icon tone-info">${icon('dollar')}</span></div><div class="kpi-value">${usd(d.profit)}</div><div class="kpi-sub">Margen ${num(d.margin, 0)}% · neto de gastos ${usd(d.profit - d.expensesUSD)}</div></div>
        </div>
        <div class="grid-main">
          <div class="stack">
            ${d.byDay.length > 1 ? `<div class="card"><div class="card-head"><div class="card-title">${icon('chart')} Ventas por día</div></div>${barChart(d.byDay)}</div>` : ''}
            <div class="card"><div class="card-head"><div class="card-title">${icon('clock')} Ventas por hora</div><span class="small muted">Identifica tus horas pico</span></div>${d.byHour.length ? barChart(d.byHour) : emptyState('clock', 'Sin ventas en el período')}</div>
          </div>
          <div class="stack">
            <div class="card"><div class="card-head"><div class="card-title">${icon('card')} Por forma de pago</div></div>
              ${Object.keys(d.byMethod).length ? Object.entries(d.byMethod).sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => `<div class="hbar" title="${esc(methodLabel(k))}: ${usd(v.usd)}"><span class="row"><i style="width:10px;height:10px;border-radius:50%;background:${PAY_METHODS[k]?.color || '#999'}"></i>${esc(methodLabel(k))}</span><div class="track"><i style="width:${v.usd / maxM * 100}%;background:${PAY_METHODS[k]?.color || 'var(--brand)'}"></i></div><span class="num r"><b>${usd(v.usd)}</b>${v.cur === 'BS' ? `<div class="t-sub">${bs(v.orig)}</div>` : ''}</span></div>`).join('') : emptyState('card', 'Sin pagos')}</div>
            <div class="card"><div class="card-head"><div class="card-title">${icon('layers')} Por tipo de pedido</div></div>
              ${d.byType.map((t) => `<div class="between" style="padding:8px 0;border-bottom:1px dashed var(--border)"><span class="row">${icon(ORDER_TYPES[t.k].icon)} ${ORDER_TYPES[t.k].label} <span class="t-sub">(${t.n})</span></span><b class="num">${usd(t.v)}</b></div>`).join('')}
              <div class="small muted mt">Descuentos ${usd(d.discount)} · Servicio ${usd(d.service)} · Delivery ${usd(d.delivery)} · Propinas ${usd(d.tips)}</div></div>
          </div>
        </div>`;
    } else if (tab === 'products') {
      const max = d.products[0]?.revenue || 1;
      $('#r-body').innerHTML = d.products.length ? `<div class="grid-main"><div class="card card-flush"><div class="table-wrap"><table class="table"><thead><tr><th>Producto</th><th class="r">Vendidos</th><th class="r">Ingresos</th><th class="r hide-sm">Costo</th><th class="r hide-sm">Ganancia</th><th class="hide-sm" style="width:20%"></th></tr></thead><tbody>
        ${d.products.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="t-sub">${esc(p.category)}</div></td><td class="r num">${num(p.qty, 0)}</td><td class="r num"><b>${usd(p.revenue)}</b></td><td class="r num hide-sm">${usd(p.cost)}</td><td class="r num hide-sm">${usd(p.revenue - p.cost)}</td><td class="hide-sm"><div class="hbar" style="grid-template-columns:1fr;padding:0"><div class="track"><i style="width:${p.revenue / max * 100}%"></i></div></div></td></tr>`).join('')}
        </tbody></table></div></div>
        <div class="card"><div class="card-head"><div class="card-title">${icon('tag')} Por categoría</div></div>${d.categories.map((c) => `<div class="hbar" title="${esc(c.name)}: ${usd(c.revenue)}"><span class="ellipsis">${esc(c.name)}</span><div class="track"><i style="width:${c.revenue / (d.categories[0].revenue || 1) * 100}%"></i></div><b class="num">${usd(c.revenue)}</b></div>`).join('')}</div></div>`
        : `<div class="card">${emptyState('burger', 'Sin ventas en el período')}</div>`;
    } else if (tab === 'ingredients') {
      $('#r-body').innerHTML = d.ingredients.length ? `<div class="card card-flush"><div class="toolbar small muted">Insumos descontados por las recetas de lo vendido en el período.</div><div class="table-wrap"><table class="table"><thead><tr><th>Insumo</th><th class="r">Consumido</th><th class="r">Costo</th><th class="r hide-sm">Existencia actual</th></tr></thead><tbody>
        ${d.ingredients.map((g) => { const cur = store.ingredients.find((i) => i.name === g.name); return `<tr><td><b>${esc(g.name)}</b></td><td class="r num">${qtyFmt(round4(g.qty))} ${unitShort(g.unit)}</td><td class="r num">${usd(g.cost)}</td><td class="r num hide-sm">${cur ? `${qtyFmt(round4(cur.stock || 0))} ${unitShort(cur.unit)}` : '—'}</td></tr>`; }).join('')}
        <tr><td class="bold">Total</td><td></td><td class="r num bold">${usd(d.cost)}</td><td class="hide-sm"></td></tr></tbody></table></div></div>`
        : `<div class="card">${emptyState('box', 'Sin consumo registrado', 'Las ventas de productos con receta descuentan insumos.')}</div>`;
    } else {
      $('#r-body').innerHTML = d.expenses.length ? `<div class="card card-flush"><div class="toolbar"><span class="grow small muted">Gastos pagados desde la caja.</span><b>Total ${usd(d.expensesUSD)}</b></div><div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Categoría</th><th class="r">Monto</th></tr></thead><tbody>
        ${d.expenses.map((m) => `<tr><td class="small nowrap">${fmtDate(m.date)}</td><td>${esc(m.concept || '')}</td><td><span class="badge badge-neutral">${esc(m.category || '')}</span></td><td class="r num">${m.currency === 'BS' ? bs(m.amount) : usd(m.amount)}</td></tr>`).join('')}
        </tbody></table></div></div>` : `<div class="card">${emptyState('wallet', 'Sin gastos en el período')}</div>`;
    }
  }

  function exportCSV() {
    if (!data) return;
    const name = `reporte-${$('#r-sub').textContent.replace(/[^\d]+/g, '-')}`;
    if (tab === 'products') download(`${name}-productos.csv`, toCSV([['Producto', 'Categoría', 'Vendidos', 'Ingresos $', 'Costo $', 'Ganancia $'], ...data.products.map((p) => [p.name, p.category, p.qty, num(p.revenue), num(p.cost), num(p.revenue - p.cost)])]));
    else if (tab === 'ingredients') download(`${name}-insumos.csv`, toCSV([['Insumo', 'Consumido', 'Unidad', 'Costo $'], ...data.ingredients.map((g) => [g.name, num(g.qty, 3), unitShort(g.unit), num(g.cost)])]));
    else if (tab === 'expenses') download(`${name}-gastos.csv`, toCSV([['Fecha', 'Concepto', 'Categoría', 'Moneda', 'Monto'], ...data.expenses.map((m) => [fmtDate(m.date), m.concept, m.category, m.currency, num(m.amount)])]));
    else download(`${name}-ventas.csv`, toCSV([['Fecha', 'Recibo', 'Pedido', 'Tipo', 'Mesa', 'Cliente', 'Productos', 'Subtotal $', 'Descuento $', 'Servicio $', 'Delivery $', 'Propina $', 'Total $', 'Tasa', 'Total Bs', 'Costo $', 'Pagos', 'Estado'],
      ...[...data.sales, ...data.voided].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map((s) => [new Date(s.date).toLocaleString('es-VE'), s.number, s.orderNo, s.typeLabel, s.tableName || '', s.customerName || '', (s.items || []).map((i) => `${i.qty}x ${i.name}${i.variantName ? ' ' + i.variantName : ''}`).join(', '), num(s.subtotal), num(s.discount || 0), num(s.service || 0), num(s.delivery || 0), num(s.tip || 0), num(s.total), num(s.rate), num(s.totalBs), num(s.cost || 0), (s.payments || []).map((p) => `${methodLabel(p.method)} ${num(p.amount)}`).join(' + '), s.status === 'voided' ? 'Anulada' : 'Completada'])]));
  }

  function print() {
    if (!data) return;
    const d = data;
    printDoc(`Reporte ${$('#r-sub').textContent}`, `
      <div class="kpis"><div class="kpi">Ventas<b>$${num(d.total)}</b>Bs ${num(d.totalBs)}</div><div class="kpi">Pedidos<b>${d.count}</b>Prom. $${num(d.avg)}</div><div class="kpi">Costo insumos<b>$${num(d.cost)}</b></div><div class="kpi">Ganancia bruta<b>$${num(d.profit)}</b>${num(d.margin, 0)}%</div><div class="kpi">Gastos<b>$${num(d.expensesUSD)}</b></div></div>
      <h2>Formas de pago</h2><table><tbody>${Object.entries(d.byMethod).map(([k, v]) => `<tr><td>${esc(methodLabel(k))}</td><td class="r">$${num(v.usd)}</td><td class="r">${v.cur === 'BS' ? 'Bs ' + num(v.orig) : ''}</td></tr>`).join('')}</tbody></table>
      <h2>Productos</h2><table><thead><tr><th>Producto</th><th class="r">Cant.</th><th class="r">Ingresos</th><th class="r">Ganancia</th></tr></thead><tbody>${d.products.map((p) => `<tr><td>${esc(p.name)}</td><td class="r">${num(p.qty, 0)}</td><td class="r">$${num(p.revenue)}</td><td class="r">$${num(p.revenue - p.cost)}</td></tr>`).join('')}</tbody></table>
      <h2>Insumos consumidos</h2><table><tbody>${d.ingredients.map((g) => `<tr><td>${esc(g.name)}</td><td class="r">${qtyFmt(round4(g.qty))} ${unitShort(g.unit)}</td><td class="r">$${num(g.cost)}</td></tr>`).join('')}</tbody></table>`);
  }

  el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => { preset = b.dataset.pr; render(); if (preset !== 'custom') load(); else load(); });
  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; render(); });
  $('#r-from').onchange = (e) => { from = e.target.value || todayKey(); if (from > to) to = from; $('#r-to').value = to; load(); };
  $('#r-to').onchange = (e) => { to = e.target.value || todayKey(); if (to < from) from = to; $('#r-from').value = from; load(); };
  $('#r-csv').onclick = exportCSV;
  $('#r-print').onclick = print;
  render();
  load();
}
