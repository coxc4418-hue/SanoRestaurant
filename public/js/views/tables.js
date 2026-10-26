// SANO Restaurant — Mesas
import { store } from '../store.js';
import { orderTotals, cancelOrder, moveOrder, lineLabel } from '../ops.js';
import { openCharge } from '../charge.js';
import { requirePin } from '../auth.js';
import { esc, usd, bs, toast, openModal, confirmDialog, emptyState, fmtAgo, nowISO, parseNum, setBusy, promptDialog } from '../utils.js';
import { icon } from '../icons.js';
import { printPreBill } from '../shared.js';

const tableState = (t) => {
  const o = store.orderForTable(t.id);
  if (!o) return { cls: 'free', label: 'Libre', o: null };
  const tks = store.tickets.filter((k) => k.orderId === o.id);
  if (tks.some((k) => k.status === 'listo')) return { cls: 'busy ready', label: 'Para servir', o };
  if (tks.some((k) => k.status === 'pendiente' || k.status === 'preparando')) return { cls: 'busy', label: 'En cocina', o };
  return { cls: 'busy', label: 'Ocupada', o };
};

export function mount(el, { navigate }) {
  let zone = 'Todas';
  let editing = false;

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Mesas</h1><p class="view-sub" id="t-sub"></p></div>
      <div class="view-actions">
        <button class="btn btn-secondary" id="t-edit">${icon('edit')} Editar mesas</button>
        <button class="btn btn-primary" id="t-new">${icon('plus')} Nueva mesa</button>
      </div>
    </div>
    <div class="chips mb" id="t-zones"></div>
    <div class="tgrid" id="t-grid"></div>`;
  const $ = (q) => el.querySelector(q);

  function render() {
    const zones = ['Todas', ...store.settings.zones];
    if (!zones.includes(zone)) zone = 'Todas';
    $('#t-zones').innerHTML = zones.map((z) => `<button class="chip ${z === zone ? 'on' : ''}" data-z="${esc(z)}">${esc(z)} <span class="count">${z === 'Todas' ? store.tables.length : store.tables.filter((t) => t.zone === z).length}</span></button>`).join('');
    el.querySelectorAll('[data-z]').forEach((b) => b.onclick = () => { zone = b.dataset.z; render(); });
    const busy = store.tables.filter((t) => store.orderForTable(t.id)).length;
    const open = store.orders.filter((o) => o.type === 'mesa').reduce((a, o) => a + (o.total || 0), 0);
    $('#t-sub').textContent = store.tables.length ? `${busy} ocupada(s) de ${store.tables.length} · ${usd(open)} por cobrar` : 'Crea las mesas de tu local para tomar pedidos en mesa.';
    $('#t-edit').classList.toggle('btn-soft', editing);
    $('#t-edit').innerHTML = editing ? `${icon('check')} Listo` : `${icon('edit')} Editar mesas`;

    const list = store.tables.filter((t) => zone === 'Todas' || t.zone === zone);
    if (!store.tables.length) {
      $('#t-grid').innerHTML = `<div style="grid-column:1/-1" class="card">${emptyState('table', 'Aún no tienes mesas', 'Crea una por una o varias de una vez.')}<div class="center row" style="justify-content:center"><button class="btn btn-secondary" id="t-bulk">${icon('layers')} Crear varias</button><button class="btn btn-primary" id="t-first">${icon('plus')} Nueva mesa</button></div></div>`;
      $('#t-first').onclick = () => tableForm();
      $('#t-bulk').onclick = bulkCreate;
      return;
    }
    $('#t-grid').innerHTML = list.map((t) => {
      const s = tableState(t);
      const o = s.o;
      return `<button class="tcard ${s.cls}" data-t="${t.id}">
        ${editing ? `<span class="tcard-edit badge badge-brand">${icon('edit')} Editar</span>` : ''}
        <div class="tcard-name">${esc(t.name)}</div>
        <div class="tcard-state"><span class="dotc"></span>${s.label}</div>
        ${o ? `<div class="tcard-total">${usd(o.total || 0)}</div>
          <div class="tcard-meta"><span>${icon('clock')}${fmtAgo(o.createdAt)}</span><span>${icon('receipt')}${(o.items || []).reduce((a, l) => a + l.qty, 0)}</span>${o.people ? `<span>${icon('users')}${o.people}</span>` : ''}</div>`
          : `<div class="tcard-meta" style="margin-top:auto"><span>${icon('users')}${t.seats || 4} puestos</span><span>${esc(t.zone || '')}</span></div>`}
      </button>`;
    }).join('') + (editing ? `<button class="tcard tcard-add" id="t-add">${icon('plus')}Agregar mesa</button>` : '');
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => {
      const t = store.table(b.dataset.t);
      if (editing) { tableForm(t); return; }
      const o = store.orderForTable(t.id);
      if (!o) navigate('vender', { params: { tableId: t.id } });
      else tableActions(t, o);
    });
    if ($('#t-add')) $('#t-add').onclick = () => tableForm();
  }

  function tableActions(t, o) {
    const totals = orderTotals(o.items || []);
    const m = openModal({
      title: `${esc(t.name)} · Pedido #${esc(o.orderNo)}`,
      sub: `Abierta hace ${fmtAgo(o.createdAt)}${o.waiter ? ' · ' + esc(o.waiter) : ''}`,
      body: `<div class="stack">
        <div class="summary-box">
          ${(o.items || []).map((l) => `<div class="summary-row"><span>${l.qty} × ${esc(lineLabel(l))}${l.note ? ` <small class="text-warning">(${esc(l.note)})</small>` : ''}</span><b class="num">${usd(l.total)}</b></div>`).join('')}
          <div class="summary-row total"><span>Total</span><span class="num">${usd(o.total || 0)} <small class="text-bs">${bs((o.total || 0) * store.rate)}</small></span></div>
        </div>
        <div class="grid-2">
          <button class="btn btn-secondary" data-a="add">${icon('plus')} Agregar productos</button>
          <button class="btn btn-secondary" data-a="pre">${icon('receipt')} Pre-cuenta</button>
          <button class="btn btn-secondary" data-a="move">${icon('move')} Cambiar de mesa</button>
          <button class="btn btn-danger-soft" data-a="cancel">${icon('trash')} Cancelar pedido</button>
        </div>
      </div>`,
      footer: `<button class="btn btn-secondary" data-close>Cerrar</button><button class="btn btn-primary btn-lg" data-a="pay">${icon('dollar')} Cobrar ${usd(o.total || 0)}</button>`
    });
    m.el.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'add') { m.close(); navigate('vender', { params: { orderId: o.id } }); }
      if (a === 'pre') printPreBill(o, totals);
      if (a === 'pay') {
        m.close();
        await openCharge({ order: o, type: 'mesa', tableId: t.id, tableName: t.name, lines: o.items || [], customer: o.customerId ? store.customer(o.customerId) : null, waiter: o.waiter, people: o.people, note: o.note });
      }
      if (a === 'move') {
        const id = await pickTable({ allowBusy: false, exclude: t.id, title: 'Mover pedido a…' });
        if (!id) return;
        try { await moveOrder(o, id); m.close(); toast(`Pedido movido a ${store.table(id)?.name}`); } catch (e) { toast(e.message, 'danger'); }
      }
      if (a === 'cancel') {
        if (!(await requirePin('Cancelar un pedido'))) return;
        const reason = await promptDialog({ title: 'Cancelar pedido', label: 'Motivo (opcional)', confirmText: 'Cancelar pedido' });
        if (reason === null) return;
        await cancelOrder(o, reason); m.close(); toast('Pedido cancelado', 'warning');
      }
    });
  }

  function tableForm(t = null) {
    const m = openModal({
      title: t ? `Editar ${esc(t.name)}` : 'Nueva mesa', size: 'sm',
      body: `<form class="stack" data-f>
        <div class="field"><label>Nombre *</label><input class="input" name="name" value="${esc(t?.name || 'Mesa ' + (store.tables.length + 1))}" autofocus></div>
        <div class="form-grid">
          <div class="field"><label>Zona</label><select class="select" name="zone">${store.settings.zones.map((z) => `<option ${z === (t?.zone || store.settings.zones[0]) ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></div>
          <div class="field"><label>Puestos</label><input class="input" name="seats" inputmode="numeric" value="${t?.seats || 4}"></div>
        </div>
        <span class="hint">Las zonas se configuran en Configuración › Mesas.</span>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `${t ? `<button class="btn btn-danger-soft" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    const save = async (e) => {
      e?.preventDefault();
      const name = F.name.value.trim();
      if (!name) { m.el.querySelector('[data-err]').textContent = 'Escribe el nombre de la mesa.'; return; }
      if (store.tables.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== t?.id)) { m.el.querySelector('[data-err]').textContent = 'Ya existe una mesa con ese nombre.'; return; }
      const data = { name, zone: F.zone.value, seats: Math.max(1, parseNum(F.seats.value) || 4), updatedAt: nowISO() };
      if (t) await store.save('tables', t.id, data);
      else { const ref = store.newRef('tables'); await store.save('tables', ref.id, { ...data, createdAt: nowISO() }); }
      m.close(); toast(t ? 'Mesa actualizada' : 'Mesa creada');
    };
    m.el.querySelector('[data-f]').onsubmit = save;
    m.el.querySelector('[data-ok]').onclick = save;
    if (t) m.el.querySelector('[data-del]').onclick = async () => {
      if (store.orderForTable(t.id)) { toast('La mesa tiene un pedido abierto. Cóbralo o cancélalo primero.', 'warning'); return; }
      if (!(await confirmDialog({ title: 'Eliminar mesa', message: `¿Eliminar <b>${esc(t.name)}</b>?`, confirmText: 'Eliminar', danger: true }))) return;
      await store.remove('tables', t.id); m.close(); toast('Mesa eliminada');
    };
  }

  function bulkCreate() {
    const m = openModal({
      title: 'Crear varias mesas', size: 'sm',
      body: `<form class="stack" data-f>
        <div class="form-grid"><div class="field"><label>Cantidad</label><input class="input" name="n" inputmode="numeric" value="8" autofocus></div>
        <div class="field"><label>Zona</label><select class="select" name="zone">${store.settings.zones.map((z) => `<option>${esc(z)}</option>`).join('')}</select></div></div>
        <span class="hint">Se crearán “Mesa 1”, “Mesa 2”… con 4 puestos.</span>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Crear</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    const go = async (e) => {
      e?.preventDefault();
      const n = Math.min(60, Math.max(1, parseNum(F.n.value)));
      setBusy(m.el.querySelector('[data-ok]'), true);
      const b = store.batch();
      const start = store.tables.length;
      for (let i = 1; i <= n; i++) b.set(store.newRef('tables'), { name: `Mesa ${start + i}`, zone: F.zone.value, seats: 4, createdAt: nowISO() });
      await store.commit(b);
      m.close(); toast(`${n} mesas creadas`);
    };
    m.el.querySelector('[data-f]').onsubmit = go;
    m.el.querySelector('[data-ok]').onclick = go;
  }

  $('#t-new').onclick = () => tableForm();
  $('#t-edit').onclick = () => { editing = !editing; render(); };
  render();
  const off = store.on('*', (evt) => { if (['tables', 'orders', 'tickets', 'settings'].includes(evt)) render(); });
  const timer = setInterval(render, 60000);
  return () => { off(); clearInterval(timer); };
}

/** Selector de mesa. Resuelve con el id o null. */
export function pickTable({ allowBusy = true, exclude = null, current = null, title = 'Elegir mesa' } = {}) {
  return new Promise((resolve) => {
    let picked = null;
    if (!store.tables.length) { toast('Primero crea tus mesas en la sección Mesas.', 'warning'); resolve(null); return; }
    const m = openModal({
      title, size: 'lg',
      body: `<div class="tgrid">${store.tables.filter((t) => t.id !== exclude).map((t) => {
        const s = tableState(t);
        const dis = s.o && !allowBusy;
        return `<button class="tcard ${s.cls}" data-pick="${t.id}" ${dis ? 'disabled style="opacity:.45"' : ''} ${t.id === current ? 'style="outline:2px solid var(--brand)"' : ''}>
          <div class="tcard-name">${esc(t.name)}</div><div class="tcard-state"><span class="dotc"></span>${s.label}</div>
          ${s.o ? `<div class="tcard-total">${usd(s.o.total || 0)}</div>` : `<div class="tcard-meta" style="margin-top:auto"><span>${esc(t.zone || '')}</span></div>`}
        </button>`;
      }).join('')}</div>`,
      onClose: () => resolve(picked)
    });
    m.el.querySelectorAll('[data-pick]').forEach((b) => b.onclick = () => { picked = b.dataset.pick; m.close(); });
  });
}
