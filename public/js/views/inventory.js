// SANO Restaurant — Inventario de insumos (ingredientes, bebidas, empaques)
import { store, UNITS, unitShort, compatibleUnits, convertQty } from '../store.js';
import { moveIngredient } from '../ops.js';
import { requirePin } from '../auth.js';
import { esc, usd, bs, num, toast, openModal, confirmDialog, emptyState, normalize, debounce, parseNum, nowISO, qtyFmt, round2, round4, setBusy, fmtDateTime, startOfDay, addDays, toCSV, download } from '../utils.js';
import { icon } from '../icons.js';
import { printDoc, stockText, usdUnit } from '../shared.js';

const MODES = {
  compra: { label: 'Compra / entrada', icon: 'download', tone: 'badge-success' },
  merma: { label: 'Merma / desperdicio', icon: 'trash', tone: 'badge-danger' },
  conteo: { label: 'Ajuste por conteo', icon: 'scale', tone: 'badge-info' }
};
const LOG_LABEL = { compra: 'Compra', entrada: 'Entrada', merma: 'Merma', salida: 'Salida', conteo: 'Conteo' };

const usedIn = (ingId) => store.products.filter((p) => [...(p.recipe || []), ...(p.variants || []).flatMap((v) => v.recipe || []), ...(p.extras || []).flatMap((x) => x.recipe || [])].some((r) => r.ingredientId === ingId));
const level = (i) => ((Number(i.stock) || 0) <= 0 ? 'out' : (Number(i.stock) || 0) <= (Number(i.minStock) || 0) ? 'low' : 'ok');

export function mount(el) {
  let tab = 'items';
  let filter = 'all';
  let q = '';
  let logs = null;

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Inventario</h1><p class="view-sub">Insumos que usan tus recetas. Cada venta descuenta lo que consume.</p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="i-buy">${icon('download')} Registrar compra</button><button class="btn btn-primary" id="i-new">${icon('plus')} Nuevo insumo</button></div>
    </div>
    <div class="kpis" id="i-kpis"></div>
    <div class="tabs"><button data-tab="items">Insumos</button><button data-tab="shop">Lista de compras <span class="badge badge-warning" id="i-low">0</span></button><button data-tab="logs">Movimientos</button></div>
    <div id="i-body"></div>`;
  const $ = (s) => el.querySelector(s);

  function kpis() {
    const low = store.lowIngredients.length; const out = store.outIngredients.length;
    const value = store.ingredients.reduce((a, i) => a + Math.max(0, Number(i.stock) || 0) * (Number(i.cost) || 0), 0);
    $('#i-kpis').innerHTML = `
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Insumos</span><span class="kpi-icon tone-brand">${icon('box')}</span></div><div class="kpi-value">${store.ingredients.length}</div><div class="kpi-sub">registrados</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Stock bajo</span><span class="kpi-icon tone-warning">${icon('alert')}</span></div><div class="kpi-value">${low - out}</div><div class="kpi-sub">por debajo del mínimo</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Agotados</span><span class="kpi-icon tone-danger">${icon('x')}</span></div><div class="kpi-value">${out}</div><div class="kpi-sub">sin existencia</div></div>
      <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Valor del inventario</span><span class="kpi-icon tone-success">${icon('dollar')}</span></div><div class="kpi-value">${usd(value)}</div><div class="kpi-sub">${bs(value * store.rate)}</div></div>`;
    $('#i-low').textContent = low;
  }

  function render() {
    kpis();
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'items') renderItems(); else if (tab === 'shop') renderShop(); else renderLogs();
  }

  function renderItems() {
    if (!$('#i-q')) {
      $('#i-body').innerHTML = `<div class="card card-flush"><div class="toolbar"><label class="search">${icon('search')}<input id="i-q" placeholder="Buscar insumo…" value="${esc(q)}"></label>
        <div class="seg" id="i-filter"><button data-f="all">Todos</button><button data-f="low">Bajo stock</button><button data-f="out">Agotados</button></div></div><div id="i-list"></div></div>`;
      $('#i-q').oninput = debounce((e) => { q = e.target.value; renderItems(); }, 120);
      el.querySelectorAll('[data-f]').forEach((b) => b.onclick = () => { filter = b.dataset.f; renderItems(); });
    }
    el.querySelectorAll('[data-f]').forEach((b) => b.classList.toggle('on', b.dataset.f === filter));
    const nq = normalize(q);
    const list = store.ingredients.filter((i) => (!nq || normalize(i.name + ' ' + i.category).includes(nq)) && (filter === 'all' || (filter === 'low' && level(i) !== 'ok') || (filter === 'out' && level(i) === 'out')));
    if (!store.ingredients.length) {
      $('#i-list').innerHTML = `<div style="padding:10px">${emptyState('box', 'Aún no hay insumos', 'Registra lo que compras: panes, salchichas, carne, queso, salsas, refrescos, envases… Luego úsalos en las recetas del menú.')}</div>`;
      return;
    }
    $('#i-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Insumo</th><th>Existencia</th><th class="r hide-sm">Mínimo</th><th class="r hide-sm">Costo unit.</th><th class="r hide-sm">Valor</th><th class="hide-sm">Se usa en</th><th class="r">Acciones</th></tr></thead>
      <tbody>${list.map((i) => {
        const lv = level(i); const st = Number(i.stock) || 0; const min = Number(i.minStock) || 0;
        const pct = Math.max(4, Math.min(100, min > 0 ? st / (min * 3) * 100 : st > 0 ? 100 : 0));
        const uses = usedIn(i.id);
        return `<tr style="${i.active === false ? 'opacity:.5' : ''}">
          <td><div class="t-name">${esc(i.name)}</div><div class="t-sub">${esc(i.category || '')}${i.supplier ? ' · ' + esc(i.supplier) : ''}</div></td>
          <td><div class="row"><b class="num ${lv === 'out' ? 'text-danger' : lv === 'low' ? 'text-warning' : ''}">${stockText(i)}</b>${lv !== 'ok' ? `<span class="badge ${lv === 'out' ? 'badge-danger' : 'badge-warning'}">${lv === 'out' ? 'Agotado' : 'Bajo'}</span>` : ''}</div><div class="stockbar ${lv}" style="margin-top:6px;max-width:140px"><i style="width:${pct}%"></i></div></td>
          <td class="r num hide-sm">${qtyFmt(min)} ${unitShort(i.unit)}</td>
          <td class="r num hide-sm">${usdUnit(i.cost || 0)}<div class="t-sub">por ${unitShort(i.unit)}</div></td>
          <td class="r num hide-sm">${usd(Math.max(0, st) * (Number(i.cost) || 0))}</td>
          <td class="hide-sm small muted" style="max-width:220px">${uses.length ? uses.slice(0, 3).map((p) => esc(p.name)).join(', ') + (uses.length > 3 ? ` +${uses.length - 3}` : '') : '<span class="faint">—</span>'}</td>
          <td class="r nowrap"><button class="btn btn-soft btn-sm" data-mv="${i.id}">${icon('plus')} Mover</button><button class="btn btn-ghost btn-icon btn-sm" data-ed="${i.id}" title="Editar">${icon('edit')}</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>` : `<div style="padding:10px">${emptyState(filter === 'all' ? 'search' : 'check', filter === 'all' ? 'Sin resultados' : '¡Todo en orden!', filter === 'all' ? '' : 'No hay insumos en esta condición.')}</div>`;
    el.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => movementForm(store.ingredient(b.dataset.mv)));
    el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => ingredientForm(store.ingredient(b.dataset.ed)));
  }

  function shopList() {
    return store.lowIngredients.map((i) => {
      const min = Number(i.minStock) || 0; const st = Math.max(0, Number(i.stock) || 0);
      const need = round2(Math.max(min * 2 - st, min - st, 1));
      return { i, need, cost: need * (Number(i.lastCost || i.cost) || 0) };
    });
  }
  function renderShop() {
    const list = shopList();
    const total = list.reduce((a, x) => a + x.cost, 0);
    $('#i-body').innerHTML = `<div class="card">
      <div class="card-head"><div><div class="card-title">${icon('clipboard')} Lista de compras sugerida</div><div class="small muted">Para dejar cada insumo en el doble de su mínimo.</div></div>
        <div class="row"><button class="btn btn-secondary btn-sm" id="s-print" ${list.length ? '' : 'disabled'}>${icon('print')} Imprimir</button><a class="btn btn-whatsapp btn-sm" id="s-wa" target="_blank" rel="noopener" ${list.length ? '' : 'hidden'}>${icon('whatsapp')} Enviar</a></div></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Insumo</th><th class="r">Hay</th><th class="r">Comprar</th><th class="r">Costo aprox.</th><th></th></tr></thead><tbody>
        ${list.map((x) => `<tr><td><b>${esc(x.i.name)}</b><div class="t-sub">${esc(x.i.supplier || x.i.category || '')}</div></td><td class="r num">${stockText(x.i)}</td><td class="r num"><b>${qtyFmt(x.need)} ${unitShort(x.i.unit)}</b></td><td class="r num">${usd(x.cost)}</td><td class="r"><button class="btn btn-soft btn-sm" data-buy="${x.i.id}">${icon('download')} Compré</button></td></tr>`).join('')}
        <tr><td colspan="3" class="r bold">Total estimado</td><td class="r num bold">${usd(total)}<div class="t-sub text-bs">${bs(total * store.rate)}</div></td><td></td></tr></tbody></table></div>`
        : emptyState('check', 'No hace falta comprar nada', 'Todos los insumos están por encima de su stock mínimo.')}
    </div>`;
    el.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => movementForm(store.ingredient(b.dataset.buy), 'compra', shopList().find((x) => x.i.id === b.dataset.buy)?.need));
    if (!list.length) return;
    const text = `🛒 Lista de compras · ${store.businessName}\n\n` + list.map((x) => `• ${x.i.name}: ${qtyFmt(x.need)} ${unitShort(x.i.unit)}`).join('\n') + `\n\nTotal aprox.: ${usd(total)}`;
    $('#s-wa').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    $('#s-print').onclick = () => printDoc('Lista de compras', `<table><thead><tr><th>Insumo</th><th>Proveedor</th><th class="r">Existencia</th><th class="r">Comprar</th><th class="r">Costo aprox.</th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(x.i.name)}</td><td>${esc(x.i.supplier || '')}</td><td class="r">${stockText(x.i)}</td><td class="r"><b>${qtyFmt(x.need)} ${unitShort(x.i.unit)}</b></td><td class="r">$${num(x.cost)}</td></tr>`).join('')}</tbody></table><p><b>Total estimado: $${num(total)}</b></p>`);
  }

  async function renderLogs() {
    if (!logs) {
      $('#i-body').innerHTML = '<div class="card"><div class="empty"><div class="spinner"></div></div></div>';
      try { logs = (await store.listBetween('inventory_logs', startOfDay(addDays(new Date(), -30)).toISOString(), new Date(Date.now() + 864e5).toISOString())).sort((a, b) => (b.date || '').localeCompare(a.date || '')); }
      catch (e) { logs = []; }
      if (tab !== 'logs') return;
    }
    $('#i-body').innerHTML = `<div class="card card-flush">
      <div class="toolbar"><div class="grow small muted">Compras, mermas y ajustes de los últimos 30 días. El consumo por ventas se ve en Reportes › Insumos.</div><button class="btn btn-secondary btn-sm" id="l-csv" ${logs.length ? '' : 'disabled'}>${icon('download')} Exportar</button></div>
      ${logs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Insumo</th><th>Tipo</th><th class="r">Cantidad</th><th class="r hide-sm">Antes → Después</th><th class="r hide-sm">Costo</th><th class="hide-sm">Motivo</th></tr></thead><tbody>
      ${logs.map((l) => `<tr><td class="nowrap small">${fmtDateTime(l.date)}</td><td><b>${esc(l.ingredientName)}</b></td><td><span class="badge ${MODES[l.type]?.tone || 'badge-neutral'}">${LOG_LABEL[l.type] || l.type}</span></td>
        <td class="r num ${l.qty < 0 ? 'text-danger' : 'text-success'}">${l.qty > 0 ? '+' : ''}${qtyFmt(round4(l.qty))} ${unitShort(l.unit)}</td><td class="r num hide-sm small">${qtyFmt(l.before)} → ${qtyFmt(l.after)}</td>
        <td class="r num hide-sm">${l.totalCost ? usd(l.totalCost) : ''}</td><td class="hide-sm small muted">${esc(l.reason || '')}</td></tr>`).join('')}</tbody></table></div>`
        : `<div style="padding:10px">${emptyState('list', 'Sin movimientos', 'Aquí verás compras, mermas y ajustes.')}</div>`}</div>`;
    const csv = $('#l-csv');
    if (csv) csv.onclick = () => download(`movimientos-inventario.csv`, toCSV([['Fecha', 'Insumo', 'Tipo', 'Cantidad', 'Unidad', 'Antes', 'Después', 'Costo $', 'Motivo'], ...logs.map((l) => [fmtDateTime(l.date), l.ingredientName, LOG_LABEL[l.type] || l.type, num(l.qty, 3), unitShort(l.unit), num(l.before, 3), num(l.after, 3), num(l.totalCost || 0), l.reason || ''])]));
  }

  el.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { tab = b.dataset.tab; $('#i-body').innerHTML = ''; if (tab === 'logs') logs = null; render(); });
  $('#i-new').onclick = () => ingredientForm();
  $('#i-buy').onclick = () => { if (!store.ingredients.length) { toast('Primero crea tus insumos.', 'warning'); return; } movementForm(null, 'compra'); };
  render();
  const off = store.on('*', (evt) => { if (evt === 'ingredients' || evt === 'products' || evt === 'rate') { kpis(); if (tab !== 'logs') render(); } });
  return off;
}

// ======================================================================
// Formulario de insumo. Resuelve con el id guardado o null.
// ======================================================================
export function ingredientForm(ing = null, { quick = false } = {}) {
  return new Promise((resolve) => {
    let savedId = null;
    const cats = store.settings.ingredientCategories;
    const m = openModal({
      title: ing ? `Editar ${esc(ing.name)}` : 'Nuevo insumo', sub: 'Registra el insumo en la unidad en que lo usas en las recetas (ej. queso en gramos o rebanadas).', size: 'lg',
      body: `<form class="stack" data-f autocomplete="off">
        <div class="form-grid">
          <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(ing?.name || '')}" placeholder="Ej.: Pan de perro, Salchicha, Queso amarillo" autofocus></div>
          <div class="field"><label>Categoría</label><select class="select" name="category">${cats.map((c) => `<option ${c === (ing?.category || '') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
          <div class="field"><label>Unidad de medida</label><select class="select" name="unit">${Object.entries(UNITS).map(([k, u]) => `<option value="${k}" ${k === (ing?.unit || 'und') ? 'selected' : ''}>${u.label} (${u.short})</option>`).join('')}</select></div>
          ${ing ? '' : `<div class="field"><label>Existencia actual</label><div class="row"><input class="input" name="stock" inputmode="decimal" placeholder="0"><span class="small muted" data-u></span></div></div>`}
          <div class="field"><label>Stock mínimo (alerta)</label><div class="row"><input class="input" name="minStock" inputmode="decimal" value="${ing ? String(ing.minStock ?? 0).replace('.', ',') : ''}" placeholder="Ej.: 10"><span class="small muted" data-u></span></div><span class="hint">Te avisamos cuando quede esta cantidad o menos.</span></div>
          <div class="field"><label>Costo por unidad ($)</label><div class="input-group"><span class="prefix">$</span><input class="input" name="cost" inputmode="decimal" value="${ing?.cost ? String(round4(ing.cost)).replace('.', ',') : ''}" placeholder="0,00"></div><span class="hint" data-costhint></span></div>
          <div class="field"><label>Proveedor (opcional)</label><input class="input" name="supplier" value="${esc(ing?.supplier || '')}" placeholder="Ej.: Distribuidora El Pan"></div>
        </div>
        <div class="box">
          <div class="bold small">Calculadora de costo</div>
          <div class="row row-wrap mt"><span class="small">Compré</span><input class="input input-sm" style="width:80px" data-cq inputmode="decimal" placeholder="20"><select class="select input-sm" style="width:120px" data-cu></select><span class="small">por</span><div class="input-group" style="width:110px"><span class="prefix">$</span><input class="input input-sm" data-cp inputmode="decimal" placeholder="10,00"></div><button type="button" class="btn btn-soft btn-sm" data-calc>Calcular</button></div>
        </div>
        ${ing ? `<label class="check"><span class="switch"><input type="checkbox" data-active ${ing.active !== false ? 'checked' : ''}><span></span></span> Insumo activo</label>` : ''}
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `${ing && !quick ? `<button class="btn btn-danger-soft" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => resolve(savedId)
    });
    const F = m.el.querySelector('[data-f]').elements;
    const $ = (s) => m.el.querySelector(s);
    const updUnit = () => {
      m.el.querySelectorAll('[data-u]').forEach((s) => { s.textContent = unitShort(F.unit.value); });
      $('[data-cu]').innerHTML = compatibleUnits(F.unit.value).map((u) => `<option value="${u}" ${u === F.unit.value ? 'selected' : ''}>${UNITS[u].label}</option>`).join('');
      $('[data-costhint]').textContent = `Precio de 1 ${UNITS[F.unit.value].label.toLowerCase()}.`;
    };
    F.unit.onchange = updUnit; updUnit();
    $('[data-calc]').onclick = () => {
      const q = parseNum($('[data-cq]').value); const p = parseNum($('[data-cp]').value);
      if (!(q > 0) || !(p > 0)) { toast('Indica cantidad y precio de la compra', 'warning'); return; }
      const inBase = convertQty(q, $('[data-cu]').value, F.unit.value);
      F.cost.value = String(round4(p / inBase)).replace('.', ',');
      toast(`Costo: $${num(p / inBase, 4)} por ${unitShort(F.unit.value)}`, 'info');
    };
    const save = async (e) => {
      e?.preventDefault();
      const err = $('[data-err]'); err.textContent = '';
      const name = F.name.value.trim();
      if (!name) { err.textContent = 'Escribe el nombre del insumo.'; F.name.focus(); return; }
      if (store.ingredients.some((x) => x.id !== ing?.id && normalize(x.name) === normalize(name))) { err.textContent = 'Ya existe un insumo con ese nombre.'; return; }
      const data = {
        name, category: F.category.value, unit: F.unit.value, minStock: parseNum(F.minStock.value), cost: round4(parseNum(F.cost.value)),
        supplier: F.supplier.value.trim(), updatedAt: nowISO()
      };
      if (ing) {
        if (ing.unit !== data.unit && (Number(ing.stock) || 0) !== 0 && !(await confirmDialog({ title: 'Cambiar unidad', message: 'Cambiar la unidad no convierte la existencia ni las recetas que usan este insumo. ¿Continuar?', confirmText: 'Cambiar' }))) return;
        data.active = $('[data-active]').checked;
        await store.save('ingredients', ing.id, data);
        savedId = ing.id;
      } else {
        const ref = store.newRef('ingredients');
        const stock = parseNum(F.stock.value);
        const b = store.batch();
        b.set(ref, { ...data, stock, active: true, createdAt: nowISO() });
        if (stock) b.set(store.newRef('inventory_logs'), { ingredientId: ref.id, ingredientName: name, unit: data.unit, date: nowISO(), type: 'entrada', qty: stock, before: 0, after: stock, totalCost: round2(stock * data.cost), reason: 'Existencia inicial', by: '' });
        await store.commit(b);
        savedId = ref.id;
      }
      toast('Insumo guardado');
      m.close();
    };
    m.el.querySelector('[data-f]').onsubmit = save;
    $('[data-ok]').onclick = save;
    const del = $('[data-del]');
    if (del) del.onclick = async () => {
      const uses = usedIn(ing.id);
      if (uses.length) { toast(`No se puede eliminar: se usa en ${uses.map((p) => p.name).slice(0, 3).join(', ')}${uses.length > 3 ? '…' : ''}. Quítalo de esas recetas o desactívalo.`, 'warning', 6000); return; }
      if (!(await requirePin('Eliminar un insumo'))) return;
      if (!(await confirmDialog({ title: 'Eliminar insumo', message: `¿Eliminar <b>${esc(ing.name)}</b>?`, confirmText: 'Eliminar', danger: true }))) return;
      await store.remove('ingredients', ing.id); m.close(); toast('Insumo eliminado');
    };
  });
}

// ======================================================================
// Movimiento: compra, merma o ajuste por conteo
// ======================================================================
export function movementForm(ing = null, mode = 'compra', suggestQty = null) {
  let current = ing;
  const m = openModal({
    title: 'Movimiento de inventario', size: 'md',
    body: `<form class="stack" data-f autocomplete="off">
      <div class="field"><label>Insumo</label><select class="select" name="ing">${store.ingredients.map((i) => `<option value="${i.id}" ${i.id === ing?.id ? 'selected' : ''}>${esc(i.name)} · hay ${stockText(i)}</option>`).join('')}</select></div>
      <div class="seg seg-block">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-mode="${k}">${icon(v.icon)} <span class="hide-sm">${v.label}</span></button>`).join('')}</div>
      <div class="small muted" data-mhint></div>
      <div class="form-grid">
        <div class="field"><label data-qlabel>Cantidad</label><div class="row"><input class="input input-lg" name="qty" inputmode="decimal" placeholder="0" value="${suggestQty ? String(suggestQty).replace('.', ',') : ''}" autofocus><select class="select" name="unit" style="width:130px"></select></div></div>
        <div class="field" data-costf><label>Total pagado ($)</label><div class="input-group"><span class="prefix">$</span><input class="input input-lg" name="total" inputmode="decimal" placeholder="0,00"></div><span class="hint" data-ucost></span></div>
      </div>
      <div data-payf class="box"><label class="check"><input type="checkbox" name="pay"> <span>Pagar con dinero de la caja</span></label>
        <div class="row mt" data-paycur hidden><span class="small">Moneda:</span><div class="seg"><button type="button" data-pc="USD" class="on">Dólares</button><button type="button" data-pc="BS">Bolívares</button></div></div></div>
      <div class="field"><label>Motivo / nota</label><input class="input" name="reason" placeholder="Opcional"></div>
      <div class="summary-box" data-preview></div>
      <div class="error-msg" data-err></div>
    </form>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Registrar</button>`
  });
  const $ = (s) => m.el.querySelector(s);
  const F = $('[data-f]').elements;
  let payCur = 'USD';

  const preview = () => {
    current = store.ingredient(F.ing.value);
    if (!current) return;
    const q = convertQty(parseNum(F.qty.value), F.unit.value, current.unit);
    const before = Number(current.stock) || 0;
    const after = mode === 'compra' ? before + q : mode === 'conteo' ? q : before - q;
    $('[data-preview]').innerHTML = `<div class="summary-row"><span class="muted">Existencia actual</span><b>${stockText(current)}</b></div><div class="summary-row"><span class="muted">Quedará en</span><b class="${after < 0 ? 'text-danger' : ''}">${qtyFmt(round4(after))} ${unitShort(current.unit)}</b></div>`;
    const tot = parseNum(F.total.value);
    $('[data-ucost]').textContent = mode === 'compra' && q > 0 && tot > 0 ? `= ${usd(tot / q)} por ${unitShort(current.unit)} · ${bs(tot * store.rate)}` : '';
  };
  const setUnits = () => {
    current = store.ingredient(F.ing.value);
    if (!current) return;
    F.unit.innerHTML = compatibleUnits(current.unit).map((u) => `<option value="${u}" ${u === current.unit ? 'selected' : ''}>${UNITS[u].label}</option>`).join('');
    preview();
  };
  const setMode = (k) => {
    mode = k;
    m.el.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === k));
    $('[data-costf]').hidden = k !== 'compra';
    $('[data-payf]').hidden = k !== 'compra';
    $('[data-qlabel]').textContent = k === 'conteo' ? 'Existencia contada' : 'Cantidad';
    $('[data-mhint]').textContent = k === 'compra' ? 'Suma al inventario y actualiza el costo promedio del insumo.' : k === 'merma' ? 'Resta del inventario lo que se dañó, venció o se desperdició.' : 'Escribe lo que contaste físicamente; el sistema ajusta la diferencia.';
    preview();
  };
  m.el.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  m.el.querySelectorAll('[data-pc]').forEach((b) => b.onclick = () => { payCur = b.dataset.pc; m.el.querySelectorAll('[data-pc]').forEach((x) => x.classList.toggle('on', x === b)); });
  F.pay.onchange = () => { $('[data-paycur]').hidden = !F.pay.checked; };
  F.ing.onchange = setUnits;
  F.unit.onchange = preview; F.qty.oninput = preview; F.total.oninput = preview;
  if (!ing && store.ingredients.length) F.ing.value = (store.lowIngredients[0] || store.ingredients[0]).id;
  setUnits(); setMode(mode);

  const save = async (e) => {
    e?.preventDefault();
    const err = $('[data-err]'); err.textContent = '';
    const qty = parseNum(F.qty.value);
    if (!current) { err.textContent = 'Elige el insumo.'; return; }
    if (mode !== 'conteo' && !(qty > 0)) { err.textContent = 'Indica la cantidad.'; F.qty.focus(); return; }
    if (mode === 'conteo' && qty < 0) { err.textContent = 'La existencia no puede ser negativa.'; return; }
    if (mode !== 'compra' && !(await requirePin(mode === 'merma' ? 'Registrar merma' : 'Ajustar inventario'))) return;
    const btn = $('[data-ok]'); setBusy(btn, true);
    try {
      await moveIngredient(current, { mode, qty, unit: F.unit.value, reason: F.reason.value.trim(), totalCost: mode === 'compra' ? parseNum(F.total.value) : 0, payFromCash: mode === 'compra' && F.pay.checked, payCurrency: payCur });
      m.close(); toast(`${MODES[mode].label} registrada: ${current.name}`);
    } catch (ex) { err.textContent = ex.message; setBusy(btn, false); }
  };
  $('[data-f]').onsubmit = save;
  $('[data-ok]').onclick = save;
}
