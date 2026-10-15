// SANO Restaurant — Clientes
import { store } from '../store.js';
import { requirePin } from '../auth.js';
import { esc, usd, toast, openModal, confirmDialog, emptyState, normalize, debounce, nowISO, initials, colorFor, fmtDate, fmtDateTime, waLink, setBusy, toCSV, download, num } from '../utils.js';
import { icon } from '../icons.js';

export function mount(el) {
  let q = '';
  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Clientes</h1><p class="view-sub">Tus clientes frecuentes, sus datos de delivery y lo que han consumido.</p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="c-csv">${icon('download')} Exportar</button><button class="btn btn-primary" id="c-new">${icon('plus')} Nuevo cliente</button></div>
    </div>
    <div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="c-q" placeholder="Buscar por nombre, teléfono o cédula…"></label><span class="small muted" id="c-count"></span></div>
      <div id="c-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  function render() {
    const nq = normalize(q);
    const list = store.customers.filter((c) => !nq || normalize(`${c.name} ${c.phone} ${c.idDoc} ${c.address}`).includes(nq));
    $('#c-count').textContent = `${store.customers.length} cliente(s)`;
    $('#c-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Cliente</th><th class="hide-sm">Teléfono</th><th class="hide-sm">Dirección</th><th class="r">Visitas</th><th class="r hide-sm">Consumo</th><th class="hide-sm">Última visita</th><th></th></tr></thead>
      <tbody>${list.map((c) => `<tr>
        <td><div class="row"><span class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</span><div><div class="t-name">${esc(c.name)}</div><div class="t-sub">${esc(c.idDoc || '')}</div></div></div></td>
        <td class="hide-sm">${esc(c.phone || '—')}</td>
        <td class="hide-sm small muted" style="max-width:220px">${esc(c.address || '')}</td>
        <td class="r num">${c.visits || 0}</td>
        <td class="r num hide-sm">${usd(c.totalSpent || 0)}</td>
        <td class="hide-sm small">${c.lastVisitAt ? fmtDate(c.lastVisitAt) : '—'}</td>
        <td class="r nowrap">${c.phone ? `<a class="btn btn-ghost btn-icon btn-sm" href="${waLink(c.phone, `Hola ${c.name.split(' ')[0]}, te escribimos de ${store.businessName}.`)}" target="_blank" rel="noopener" title="WhatsApp">${icon('whatsapp')}</a>` : ''}<button class="btn btn-ghost btn-icon btn-sm" data-h="${c.id}" title="Historial">${icon('receipt')}</button><button class="btn btn-ghost btn-icon btn-sm" data-ed="${c.id}" title="Editar">${icon('edit')}</button></td>
      </tr>`).join('')}</tbody></table></div>`
      : `<div style="padding:10px">${emptyState('users', store.customers.length ? 'Sin resultados' : 'Aún no hay clientes', 'Registra clientes para delivery, pedidos frecuentes y promociones por WhatsApp.')}</div>`;
    el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => customerForm(store.customer(b.dataset.ed)));
    el.querySelectorAll('[data-h]').forEach((b) => b.onclick = () => history(store.customer(b.dataset.h)));
  }

  async function history(c) {
    const m = openModal({ title: esc(c.name), sub: `${c.visits || 0} visita(s) · consumo total ${usd(c.totalSpent || 0)}`, size: 'lg', body: '<div class="empty"><div class="spinner"></div></div>', footer: '<button class="btn btn-primary" data-close>Cerrar</button>' });
    let sales = [];
    try { sales = (await store.listEq('sales', 'customerId', c.id)).filter((s) => s.status !== 'voided').sort((a, b) => (b.date || '').localeCompare(a.date || '')); } catch (_) {}
    const fav = {};
    sales.forEach((s) => (s.items || []).forEach((i) => { fav[i.name] = (fav[i.name] || 0) + i.qty; }));
    const top = Object.entries(fav).sort((a, b) => b[1] - a[1]).slice(0, 5);
    m.el.querySelector('.modal-body').innerHTML = sales.length ? `<div class="stack">
      ${top.length ? `<div><div class="section-title">Lo que más pide</div><div class="row row-wrap mt">${top.map(([n, q]) => `<span class="badge badge-brand">${esc(n)} × ${num(q, 0)}</span>`).join('')}</div></div>` : ''}
      <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Productos</th><th class="r">Total</th></tr></thead><tbody>
      ${sales.slice(0, 50).map((s) => `<tr><td class="nowrap small">${fmtDateTime(s.date)}</td><td>#${esc(s.orderNo)} <span class="t-sub">${esc(s.typeLabel || '')}</span></td><td class="small">${(s.items || []).map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</td><td class="r num"><b>${usd(s.total)}</b></td></tr>`).join('')}
      </tbody></table></div></div>` : emptyState('receipt', 'Sin compras registradas');
  }

  $('#c-new').onclick = () => customerForm();
  $('#c-q').oninput = debounce((e) => { q = e.target.value; render(); }, 120);
  $('#c-csv').onclick = () => download('clientes.csv', toCSV([['Nombre', 'Cédula/RIF', 'Teléfono', 'Dirección', 'Visitas', 'Consumo $', 'Notas'], ...store.customers.map((c) => [c.name, c.idDoc || '', c.phone || '', c.address || '', c.visits || 0, num(c.totalSpent || 0), c.notes || ''])]));
  render();
  return store.on('customers', render);
}

/** Formulario de cliente. Resuelve con el cliente guardado o null. */
export function customerForm(c = null, preset = {}) {
  return new Promise((resolve) => {
    let saved = null;
    const m = openModal({
      title: c ? 'Editar cliente' : 'Nuevo cliente', size: 'md',
      body: `<form class="form-grid" data-f autocomplete="off">
        <div class="field full"><label>Nombre *</label><input class="input" name="name" value="${esc(c?.name || preset.name || '')}" placeholder="Nombre y apellido" autofocus></div>
        <div class="field"><label>Teléfono / WhatsApp</label><input class="input" name="phone" inputmode="tel" value="${esc(c?.phone || preset.phone || '')}" placeholder="0414-1234567"></div>
        <div class="field"><label>Cédula / RIF</label><input class="input" name="idDoc" value="${esc(c?.idDoc || '')}" placeholder="V-12345678"></div>
        <div class="field full"><label>Dirección (para delivery)</label><input class="input" name="address" value="${esc(c?.address || '')}" placeholder="Urbanización, calle, casa, punto de referencia"></div>
        <div class="field full"><label>Notas</label><input class="input" name="notes" value="${esc(c?.notes || '')}" placeholder="Ej.: alérgico al maní, prefiere salsa aparte"></div>
        <div class="error-msg full" data-err></div>
      </form>`,
      footer: `${c ? `<button class="btn btn-danger-soft" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar</button>`,
      onClose: () => resolve(saved)
    });
    const F = m.el.querySelector('[data-f]').elements;
    const save = async (e) => {
      e?.preventDefault();
      const name = F.name.value.trim();
      if (!name) { m.el.querySelector('[data-err]').textContent = 'Escribe el nombre del cliente.'; F.name.focus(); return; }
      const phone = F.phone.value.trim();
      if (phone && store.customers.some((x) => x.id !== c?.id && x.phone && x.phone.replace(/\D/g, '') === phone.replace(/\D/g, ''))) { m.el.querySelector('[data-err]').textContent = 'Ya hay un cliente con ese teléfono.'; return; }
      const data = { name, phone, idDoc: F.idDoc.value.trim(), address: F.address.value.trim(), notes: F.notes.value.trim(), updatedAt: nowISO() };
      setBusy(m.el.querySelector('[data-ok]'), true);
      if (c) { await store.save('customers', c.id, data); saved = { ...c, ...data }; }
      else { const ref = store.newRef('customers'); const d = { ...data, visits: 0, totalSpent: 0, createdAt: nowISO() }; await store.save('customers', ref.id, d, false); saved = { id: ref.id, ...d }; }
      toast('Cliente guardado');
      m.close();
    };
    m.el.querySelector('[data-f]').onsubmit = save;
    m.el.querySelector('[data-ok]').onclick = save;
    const del = m.el.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await requirePin('Eliminar un cliente'))) return;
      if (!(await confirmDialog({ title: 'Eliminar cliente', message: `¿Eliminar a <b>${esc(c.name)}</b>? Sus ventas anteriores se conservan.`, confirmText: 'Eliminar', danger: true }))) return;
      await store.remove('customers', c.id); m.close(); toast('Cliente eliminado');
    };
  });
}

/**
 * Selector rápido de cliente para el punto de venta.
 * Resuelve con el cliente, null (quitar) o undefined (cancelar).
 */
export function pickCustomer({ current = null } = {}) {
  return new Promise((resolve) => {
    let result;
    const m = openModal({
      title: 'Cliente del pedido', size: 'md',
      body: `<div class="stack">
        <label class="search">${icon('search')}<input data-q placeholder="Buscar por nombre o teléfono…" autofocus></label>
        <div class="list" data-list style="max-height:340px;overflow:auto"></div>
      </div>`,
      footer: `${current ? `<button class="btn btn-ghost" data-none style="margin-right:auto">Sin cliente</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-new>${icon('plus')} Nuevo cliente</button>`,
      onClose: () => resolve(result)
    });
    const render = (q = '') => {
      const nq = normalize(q);
      const list = store.customers.filter((c) => !nq || normalize(`${c.name} ${c.phone} ${c.idDoc}`).includes(nq)).slice(0, 40);
      m.el.querySelector('[data-list]').innerHTML = list.length ? list.map((c) => `<button type="button" class="list-item" data-c="${c.id}" style="border:0;background:transparent;text-align:left;width:100%;border-bottom:1px solid var(--border);${c.id === current?.id ? 'background:var(--brand-soft)' : ''}">
        <span class="avatar" style="background:${colorFor(c.name)}">${esc(initials(c.name))}</span><div class="grow"><div class="t-name">${esc(c.name)}</div><div class="t-sub">${esc(c.phone || '')}${c.address ? ' · ' + esc(c.address) : ''}</div></div><span class="t-sub">${c.visits || 0} visitas</span></button>`).join('')
        : emptyState('users', q ? 'No encontrado' : 'Sin clientes', q ? 'Créalo con “Nuevo cliente”.' : '');
      m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { result = store.customer(b.dataset.c); m.close(); });
    };
    const qi = m.el.querySelector('[data-q]');
    qi.oninput = debounce(() => render(qi.value), 80);
    m.el.querySelector('[data-new]').onclick = async () => {
      const v = qi.value.trim();
      const preset = /^[\d\s+()-]{6,}$/.test(v) ? { phone: v } : { name: v };
      const c = await customerForm(null, preset);
      if (c) { result = c; m.close(); }
    };
    const none = m.el.querySelector('[data-none]');
    if (none) none.onclick = () => { result = null; m.close(); };
    render();
  });
}
