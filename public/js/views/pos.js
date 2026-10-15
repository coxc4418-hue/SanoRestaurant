// SANO Restaurant — Punto de venta (para llevar, mesa y delivery)
import { store, ORDER_TYPES } from '../store.js';
import { cleanLine, orderTotals, saveOrder, lineLabel } from '../ops.js';
import { openCharge } from '../charge.js';
import { esc, usd, bs, toast, openModal, normalize, debounce, confirmDialog, emptyState, setBusy, shortId } from '../utils.js';
import { icon } from '../icons.js';
import { printPreBill, printKitchenTicket } from '../shared.js';
import { pickCustomer } from './customers.js';
import { pickTable } from './tables.js';

// El borrador sobrevive al cambiar de sección (venta rápida)
let draft = newDraft();
function newDraft(type = 'llevar') {
  return { type, tableId: null, orderId: null, customer: null, waiter: '', people: 0, note: '', address: '', deliveryFee: null, lines: [] };
}

export function mount(el, { navigate, params = {} }) {
  let cat = 'Todos';
  let search = '';
  let alive = true;

  // Abrir un pedido existente o una mesa
  if (params.orderId || params.tableId) {
    const o = params.orderId ? store.order(params.orderId) : store.orderForTable(params.tableId);
    if (o) loadOrder(o);
    else { draft = newDraft('mesa'); draft.tableId = params.tableId; }
  } else if (params.type) {
    draft = newDraft(params.type);
  }

  function loadOrder(o) {
    draft = {
      type: o.type, tableId: o.tableId || null, orderId: o.id,
      customer: o.customerId ? (store.customer(o.customerId) || { id: o.customerId, name: o.customerName, phone: o.customerPhone }) : (o.customerName ? { id: null, name: o.customerName, phone: o.customerPhone } : null),
      waiter: o.waiter || '', people: o.people || 0, note: o.note || '', address: o.address || '', deliveryFee: o.deliveryFee ?? null,
      lines: (o.items || []).map((l) => ({ ...l }))
    };
  }

  el.innerHTML = `
    <div class="pos">
      <section class="pos-main">
        <div class="pos-head">
          <label class="search">${icon('search')}<input id="pos-search" placeholder="Buscar en el menú…  (F1)" autocomplete="off"></label>
          <div class="chips" id="pos-cats"></div>
        </div>
        <div class="pos-grid-wrap"><div class="pgrid" id="pos-grid"></div></div>
      </section>
      <div class="cart-backdrop" id="cart-bd"></div>
      <aside class="cart" id="cart"></aside>
      <button class="cart-fab" id="cart-fab" hidden></button>
    </div>`;
  const $ = (q) => el.querySelector(q);

  // ---------- Catálogo ----------
  function usedMap(exceptLineId = null) {
    return store.consumptionOf(draft.lines.filter((l) => !l.sent && l.lineId !== exceptLineId));
  }
  function availableUnits(p, variantId, used) {
    const recipe = store.recipeOf(p, variantId);
    let max = Infinity;
    for (const r of recipe) {
      const ing = store.ingredient(r.ingredientId); const q = Number(r.qty) || 0;
      if (!ing || q <= 0) continue;
      max = Math.min(max, Math.floor(Math.max(0, (Number(ing.stock) || 0) - (used.get(r.ingredientId) || 0)) / q + 1e-9));
    }
    return max;
  }
  function productAvail(p, used) {
    if (p.variants?.length) return Math.max(...p.variants.map((v) => availableUnits(p, v.id, used)));
    return availableUnits(p, null, used);
  }
  const priceOf = (p) => (p.variants?.length ? Math.min(...p.variants.map((v) => Number(v.price) || 0)) : Number(p.price) || 0);

  function renderCats() {
    const prods = store.products.filter((p) => p.active !== false);
    const cats = ['Todos', ...store.settings.categories.filter((c) => prods.some((p) => p.category === c)), ...[...new Set(prods.map((p) => p.category))].filter((c) => c && !store.settings.categories.includes(c))];
    if (!cats.includes(cat)) cat = 'Todos';
    $('#pos-cats').innerHTML = cats.map((c) => `<button class="chip ${c === cat ? 'on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
    el.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => { cat = b.dataset.cat; renderCats(); renderGrid(); });
  }

  function renderGrid() {
    const q = normalize(search);
    const used = usedMap();
    const inCart = {};
    draft.lines.forEach((l) => { if (!l.sent) inCart[l.productId] = (inCart[l.productId] || 0) + l.qty; });
    const list = store.products.filter((p) => p.active !== false && (cat === 'Todos' || p.category === cat) && (!q || normalize(p.name).includes(q) || normalize(p.category).includes(q)));
    if (!store.products.length) {
      $('#pos-grid').innerHTML = `<div style="grid-column:1/-1">${emptyState('burger', 'Tu menú está vacío', 'Crea tus productos y sus recetas en “Menú y recetas”.')}<div class="center"><button class="btn btn-primary" id="go-menu">${icon('plus')} Crear productos</button></div></div>`;
      $('#go-menu').onclick = () => navigate('menu');
      return;
    }
    $('#pos-grid').innerHTML = list.length ? list.map((p) => {
      const avail = productAvail(p, used);
      const out = avail <= 0 && !store.settings.allowNoStock;
      const flag = p.available === false ? '<span class="badge badge-neutral pcard-flag">No disponible</span>'
        : avail <= 0 ? '<span class="badge badge-danger pcard-flag">Agotado</span>'
          : avail <= 5 ? `<span class="badge badge-warning pcard-flag">Quedan ${avail}</span>` : '';
      return `<button class="pcard" data-p="${p.id}" ${out || p.available === false ? 'disabled' : ''}>
        ${inCart[p.id] ? `<span class="pcard-qty">${inCart[p.id]}</span>` : ''}
        ${flag}
        <div class="pcard-media" style="--pc:${esc(p.color || '')}">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(p.emoji || '🍽️')}</div>
        <div class="pcard-name">${esc(p.name)}</div>
        <div class="pcard-price"><b>${p.variants?.length ? '<small>desde</small>' : ''}${usd(priceOf(p))}</b><span>${bs(priceOf(p) * store.rate)}</span></div>
      </button>`;
    }).join('') : `<div style="grid-column:1/-1">${emptyState('search', 'Sin resultados', 'Prueba con otra búsqueda o categoría.')}</div>`;
    el.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = () => onProduct(store.product(b.dataset.p));
      b.oncontextmenu = (e) => { e.preventDefault(); openOptions(store.product(b.dataset.p)); };
    });
  }

  function onProduct(p) {
    if (!p) return;
    if (p.variants?.length || p.extras?.length) { openOptions(p); return; }
    addLine({ productId: p.id, name: p.name, basePrice: p.price, qty: 1, emoji: p.emoji, kitchen: p.kitchen !== false });
  }

  function addLine(l) {
    const same = draft.lines.find((x) => !x.sent && x.productId === l.productId && (x.variantId || null) === (l.variantId || null) && !x.note && !l.note && JSON.stringify((x.extras || []).map((e) => e.id).sort()) === JSON.stringify((l.extras || []).map((e) => e.id).sort()));
    if (same) same.qty += l.qty;
    else draft.lines.push({ ...l, lineId: shortId(10), sent: false });
    draft.lines = draft.lines.map(cleanLine);
    renderCart(); renderGrid();
    pulseFab();
  }

  // ---------- Opciones: tamaño, extras, nota y cantidad ----------
  function openOptions(p, editLine = null) {
    const used = usedMap(editLine?.lineId);
    const sel = {
      variantId: editLine?.variantId || (p.variants?.length ? (p.variants.find((v) => availableUnits(p, v.id, used) > 0) || p.variants[0]).id : null),
      extras: new Set((editLine?.extras || []).map((e) => e.id)),
      qty: editLine?.qty || 1,
      note: editLine?.note || ''
    };
    const m = openModal({
      title: `${esc(p.emoji || '')} ${esc(p.name)}`, sub: esc(p.description || p.category || ''), size: 'md',
      body: `<div class="stack">
        ${p.variants?.length ? `<div class="opt-group"><div class="section-title">Tamaño</div><div class="opt-list">${p.variants.map((v) => {
          const a = availableUnits(p, v.id, used);
          return `<button type="button" class="opt" data-v="${v.id}" ${a <= 0 && !store.settings.allowNoStock ? 'disabled' : ''}><span>${esc(v.name)}${a <= 0 ? ' <small>(agotado)</small>' : ''}</span><small>${usd(v.price)}</small></button>`;
        }).join('')}</div></div>` : ''}
        ${p.extras?.length ? `<div class="opt-group"><div class="section-title">Extras</div><div class="opt-list">${p.extras.map((x) => `<button type="button" class="opt" data-x="${x.id}"><span>${esc(x.name)}</span><small>+${usd(x.price)}</small></button>`).join('')}</div></div>` : ''}
        <div class="field"><label>Nota para la cocina</label><input class="input" data-note placeholder="Ej.: sin cebolla, salsas aparte" value="${esc(sel.note)}"></div>
        <div class="qty-big"><button type="button" data-q="-1">${icon('minus')}</button><span data-qv>1</span><button type="button" data-q="1">${icon('plus')}</button></div>
      </div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary btn-lg" data-ok></button>`
    });
    const $m = (q) => m.el.querySelector(q);
    const render = () => {
      m.el.querySelectorAll('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === sel.variantId));
      m.el.querySelectorAll('[data-x]').forEach((b) => b.classList.toggle('on', sel.extras.has(b.dataset.x)));
      $m('[data-qv]').textContent = sel.qty;
      const v = p.variants?.find((x) => x.id === sel.variantId);
      const unit = (v ? Number(v.price) : Number(p.price) || 0) + (p.extras || []).filter((x) => sel.extras.has(x.id)).reduce((a, x) => a + (Number(x.price) || 0), 0);
      $m('[data-ok]').innerHTML = `${icon(editLine ? 'check' : 'plus')} ${editLine ? 'Guardar' : 'Agregar'} · ${usd(unit * sel.qty)}`;
    };
    m.el.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { sel.variantId = b.dataset.v; render(); });
    m.el.querySelectorAll('[data-x]').forEach((b) => b.onclick = () => { sel.extras.has(b.dataset.x) ? sel.extras.delete(b.dataset.x) : sel.extras.add(b.dataset.x); render(); });
    m.el.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { sel.qty = Math.max(1, sel.qty + Number(b.dataset.q)); render(); });
    $m('[data-ok]').onclick = () => {
      const v = p.variants?.find((x) => x.id === sel.variantId);
      const line = {
        productId: p.id, name: p.name, emoji: p.emoji, kitchen: p.kitchen !== false,
        variantId: v?.id || null, variantName: v?.name || '', basePrice: v ? v.price : p.price,
        extras: (p.extras || []).filter((x) => sel.extras.has(x.id)).map((x) => ({ id: x.id, name: x.name, price: x.price })),
        qty: sel.qty, note: $m('[data-note]').value.trim()
      };
      if (editLine) {
        Object.assign(editLine, cleanLine({ ...line, lineId: editLine.lineId }));
        renderCart(); renderGrid();
      } else addLine(line);
      m.close();
    };
    render();
  }

  // ---------- Carrito ----------
  function ctxTotals() {
    return orderTotals(draft.lines, { deliveryFee: draft.type === 'delivery' ? (draft.deliveryFee ?? Number(store.settings.deliveryFee) ?? 0) : 0 });
  }

  function renderCart() {
    const t = ctxTotals();
    const table = draft.tableId ? store.table(draft.tableId) : null;
    const existing = draft.orderId ? store.order(draft.orderId) : null;
    const unsent = draft.lines.filter((l) => !l.sent);
    const staff = store.settings.staff || [];
    $('#cart').innerHTML = `
      <div class="cart-head">
        <div class="between">
          <div class="bold" style="font-size:16px">${existing ? `Pedido #${esc(existing.orderNo)}` : 'Nuevo pedido'}</div>
          <div class="row">
            ${draft.type === 'mesa' && draft.lines.length ? `<button class="btn btn-ghost btn-icon btn-sm" id="c-prebill" title="Imprimir pre-cuenta">${icon('receipt')}</button>` : ''}
            <button class="btn btn-ghost btn-icon btn-sm" id="c-clear" title="${existing ? 'Cerrar sin cambios' : 'Vaciar'}">${icon(existing ? 'x' : 'trash')}</button>
            <button class="btn btn-ghost btn-icon btn-sm" id="c-hide" title="Ocultar" style="display:none">${icon('arrowDown')}</button>
          </div>
        </div>
        <div class="seg seg-block" ${existing ? 'style="pointer-events:none;opacity:.7"' : ''}>
          ${Object.entries(ORDER_TYPES).map(([k, v]) => `<button data-type="${k}" class="${draft.type === k ? 'on' : ''}">${icon(v.icon)} ${v.label}</button>`).join('')}
        </div>
        <div class="cart-ctx">
          ${draft.type === 'mesa' ? `<button class="btn btn-secondary btn-sm" id="c-table">${icon('table')} <span class="ellipsis">${table ? esc(table.name) : 'Elegir mesa'}</span></button>` : ''}
          <button class="btn btn-secondary btn-sm" id="c-cust">${icon('users')} <span class="ellipsis">${draft.customer ? esc(draft.customer.name) : 'Cliente'}</span></button>
          ${staff.length ? `<select class="select input-sm" id="c-waiter" style="flex:1;height:32px;min-width:0"><option value="">Mesero…</option>${staff.map((s) => `<option ${s === draft.waiter ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
        </div>
        ${draft.type === 'delivery' ? `<input class="input input-sm" id="c-addr" placeholder="Dirección de entrega" value="${esc(draft.address)}">` : ''}
      </div>
      <div class="cart-list" id="c-list">
        ${draft.lines.length ? draft.lines.map((l) => `
          <div class="cline ${l.sent ? 'sent' : ''}">
            <div class="cline-name"><span>${esc(l.emoji || '')}</span><span>${l.qty > 1 && l.sent ? l.qty + ' × ' : ''}${esc(lineLabel(l))}</span></div>
            <div class="cline-total">${usd(l.total)}</div>
            <div class="cline-meta">${usd(l.unitPrice)} c/u${l.extras?.length ? ' · + ' + l.extras.map((e) => esc(e.name)).join(', ') : ''}${l.note ? ` · <span class="note">${esc(l.note)}</span>` : ''}</div>
            <div class="cline-actions">
              ${l.sent ? `<span class="badge badge-success">${icon('chef')} En cocina</span><span></span>` : `
              <div class="stepper"><button data-dec="${l.lineId}" aria-label="Menos">${icon('minus')}</button><span>${l.qty}</span><button data-inc="${l.lineId}" aria-label="Más">${icon('plus')}</button></div>
              <div class="row"><button class="btn btn-ghost btn-sm" data-edit="${l.lineId}">${icon('edit')} Nota</button><button class="btn btn-ghost btn-icon btn-sm" data-del="${l.lineId}" aria-label="Quitar">${icon('trash')}</button></div>`}
            </div>
          </div>`).join('') : `<div class="empty">${icon('cart')}<b>Pedido vacío</b><span>Toca un producto para agregarlo.</span></div>`}
      </div>
      <div class="cart-foot">
        <div class="cart-totals">
          ${t.delivery ? `<div class="between"><span>Subtotal</span><span class="num">${usd(t.subtotal)}</span></div><div class="between"><span>Delivery</span><span class="num">${usd(t.delivery)}</span></div>` : ''}
          <div class="cart-grand"><span class="lbl">TOTAL</span><div class="val"><b class="num">${usd(t.total)}</b><span class="num">${bs(t.total * store.rate)}</span></div></div>
        </div>
        <div class="cart-btns">
          ${draft.type === 'mesa'
            ? `<button class="btn btn-secondary btn-lg" id="c-send" ${unsent.length ? '' : 'disabled'}>${icon('chef')} Enviar</button>`
            : `<button class="btn btn-secondary btn-lg" id="c-save" ${unsent.length || (existing && draft.lines.length) ? '' : 'disabled'} title="Guardar el pedido y cobrar después">${icon('clock')} ${existing ? 'Guardar' : 'Cobrar luego'}</button>`}
          <button class="btn btn-primary btn-lg" id="c-pay" ${draft.lines.length ? '' : 'disabled'}>${icon('dollar')} Cobrar</button>
        </div>
      </div>`;

    const count = draft.lines.reduce((a, l) => a + (l.qty || 0), 0);
    const fab = $('#cart-fab');
    fab.hidden = !count;
    fab.innerHTML = `<span><span class="cnt">${count}</span>Ver pedido</span><span class="num">${usd(t.total)}</span>`;

    el.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => {
      draft.type = b.dataset.type;
      if (draft.type !== 'mesa') draft.tableId = null;
      renderCart();
      if (draft.type === 'mesa' && !draft.tableId) chooseTable();
    });
    const find = (id) => draft.lines.find((l) => l.lineId === id);
    el.querySelectorAll('[data-inc]').forEach((b) => b.onclick = () => { const l = find(b.dataset.inc); l.qty++; Object.assign(l, cleanLine(l)); renderCart(); renderGrid(); });
    el.querySelectorAll('[data-dec]').forEach((b) => b.onclick = () => { const l = find(b.dataset.dec); if (l.qty > 1) { l.qty--; Object.assign(l, cleanLine(l)); } else draft.lines = draft.lines.filter((x) => x !== l); renderCart(); renderGrid(); });
    el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { draft.lines = draft.lines.filter((x) => x.lineId !== b.dataset.del); renderCart(); renderGrid(); });
    el.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { const l = find(b.dataset.edit); const p = store.product(l.productId); if (p) openOptions(p, l); });
    $('#c-clear').onclick = clearCart;
    $('#c-hide').onclick = closeCartSheet;
    if ($('#c-table')) $('#c-table').onclick = chooseTable;
    $('#c-cust').onclick = async () => {
      const c = await pickCustomer({ current: draft.customer });
      if (c !== undefined) { draft.customer = c; if (c?.address && !draft.address) draft.address = c.address; renderCart(); }
    };
    if ($('#c-waiter')) $('#c-waiter').onchange = (e) => { draft.waiter = e.target.value; };
    if ($('#c-addr')) $('#c-addr').oninput = (e) => { draft.address = e.target.value; };
    if ($('#c-prebill')) $('#c-prebill').onclick = () => printPreBill({ ...(existing || {}), tableName: table?.name, orderNo: existing?.orderNo || '—', items: draft.lines }, orderTotals(draft.lines, { servicePct: Number(store.settings.serviceCharge) || 0 }));
    if ($('#c-send')) $('#c-send').onclick = (e) => persist(e.currentTarget, true);
    if ($('#c-save')) $('#c-save').onclick = (e) => persist(e.currentTarget, true);
    $('#c-pay').onclick = pay;
    $('#c-hide').style.display = matchMedia('(max-width: 980px)').matches ? '' : 'none';
  }

  async function chooseTable() {
    const id = await pickTable({ allowBusy: true, current: draft.tableId });
    if (!id) { if (!draft.tableId && !draft.lines.length) { draft.type = 'llevar'; renderCart(); } return; }
    const busy = store.orderForTable(id);
    if (busy && busy.id !== draft.orderId) {
      // La mesa ya tiene pedido: se abre para agregar productos
      const pending = draft.lines.filter((l) => !l.sent);
      loadOrder(busy);
      draft.lines.push(...pending);
    } else draft.tableId = id;
    renderCart(); renderGrid();
  }

  async function clearCart() {
    if (draft.orderId) { const wasMesa = draft.type === 'mesa'; draft = newDraft('llevar'); if (wasMesa) { navigate('mesas'); return; } renderCart(); renderGrid(); return; }
    if (draft.lines.length && !(await confirmDialog({ title: 'Vaciar pedido', message: '¿Quitar todos los productos del pedido?', confirmText: 'Vaciar', danger: true }))) return;
    draft = newDraft(draft.type);
    renderCart(); renderGrid();
  }

  /** Guarda el pedido (mesa o pendiente de cobro) y envía a cocina lo nuevo */
  async function persist(btn, sendToKitchen) {
    if (draft.type === 'mesa' && !draft.tableId) { chooseTable(); return; }
    if (!store.settings.allowNoStock) {
      const miss = store.shortages(draft.lines.filter((l) => !l.sent));
      if (miss.length) { toast('Stock insuficiente: ' + miss.map((x) => x.ing.name).join(', '), 'danger', 5000); return; }
    }
    setBusy(btn, true);
    try {
      const before = new Set(store.tickets.map((t) => t.id));
      const o = await saveOrder({
        orderId: draft.orderId, type: draft.type, tableId: draft.tableId, customer: draft.customer, lines: draft.lines,
        note: draft.note, waiter: draft.waiter, people: draft.people, address: draft.address,
        deliveryFee: draft.deliveryFee ?? Number(store.settings.deliveryFee) ?? 0, sendToKitchen
      });
      toast(draft.type === 'mesa' ? `Pedido enviado a cocina · ${o.tableName}` : `Pedido #${o.orderNo} guardado`, 'success');
      if (store.settings.printKitchen) setTimeout(() => store.tickets.filter((t) => !before.has(t.id) && t.orderId === o.id).forEach(printKitchenTicket), 300);
      const wasMesa = draft.type === 'mesa';
      draft = newDraft('llevar');
      closeCartSheet();
      if (wasMesa) navigate('mesas'); else { renderCart(); renderGrid(); }
    } catch (ex) { toast(ex?.message || String(ex), 'danger', 5000); setBusy(btn, false); }
  }

  async function pay() {
    if (draft.type === 'mesa' && !draft.tableId) { chooseTable(); return; }
    const existing = draft.orderId ? store.order(draft.orderId) : null;
    const table = draft.tableId ? store.table(draft.tableId) : null;
    const before = new Set(store.tickets.map((t) => t.id));
    const sale = await openCharge({
      order: existing, type: draft.type, tableId: draft.tableId, tableName: table?.name, lines: draft.lines, customer: draft.customer,
      waiter: draft.waiter, people: draft.people, address: draft.address, note: draft.note,
      deliveryFee: draft.deliveryFee ?? Number(store.settings.deliveryFee) ?? 0
    });
    if (!sale) return;
    if (store.settings.printKitchen) setTimeout(() => store.tickets.filter((t) => !before.has(t.id)).forEach(printKitchenTicket), 300);
    const wasMesa = draft.type === 'mesa';
    draft = newDraft(wasMesa ? 'llevar' : draft.type);
    if (!alive) return;
    closeCartSheet();
    if (wasMesa) navigate('mesas'); else { renderCart(); renderGrid(); }
  }

  // Hoja inferior del carrito en móviles
  function openCartSheet() { $('#cart').classList.add('open'); $('#cart-bd').classList.add('open'); }
  function closeCartSheet() { $('#cart')?.classList.remove('open'); $('#cart-bd')?.classList.remove('open'); }
  function pulseFab() { const f = $('#cart-fab'); f?.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 220 }); }
  $('#cart-fab').onclick = openCartSheet;
  $('#cart-bd').onclick = closeCartSheet;
  $('#pos-search').oninput = debounce((e) => { search = e.target.value; renderGrid(); }, 100);

  renderCats(); renderGrid(); renderCart();
  if (draft.type === 'mesa' && !draft.tableId && !params.tableId) setTimeout(chooseTable, 50);

  const off = store.on('*', (evt) => {
    if (evt === 'products' || evt === 'settings') { renderCats(); renderGrid(); renderCart(); }
    if (evt === 'ingredients' || evt === 'rate') { renderGrid(); renderCart(); }
    if (evt === 'orders' && draft.orderId && !store.order(draft.orderId)) {
      // El pedido se cobró o canceló en otro dispositivo
      toast('Este pedido fue cerrado en otro dispositivo.', 'info');
      draft = newDraft('llevar');
      renderCart(); renderGrid();
    }
  });
  if (!params.orderId && !params.tableId) setTimeout(() => { if (matchMedia('(min-width: 981px)').matches) $('#pos-search')?.focus(); }, 60);
  return () => { alive = false; off(); };
}

