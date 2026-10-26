// SANO Restaurant — Configuración
import { store, updateTenant } from '../store.js';
import { requirePin, changePassword, authErrorMessage, session } from '../auth.js';
import { esc, num, toast, parseNum, setBusy, toggleTheme, download, nowISO } from '../utils.js';
import { icon } from '../icons.js';
import { openRateModal, salesWa, SALES_PHONE_FMT } from '../shared.js';
import { isStandalone, bindInstallButtons } from '../install.js';

const SECTIONS = { negocio: 'Negocio', ventas: 'Ventas y cobro', mesas: 'Mesas y personal', seguridad: 'Seguridad', apps: 'Instalar y respaldo' };

export function mount(el) {
  let sec = 'negocio';
  el.innerHTML = `
    <div class="view-header"><div><h1 class="view-title">Configuración</h1><p class="view-sub">Personaliza SANO Restaurant para tu negocio.</p></div></div>
    <div class="tabs">${Object.entries(SECTIONS).map(([k, v]) => `<button data-s="${k}">${v}</button>`).join('')}</div>
    <div id="s-body" style="max-width:860px"></div>`;
  const $ = (q) => el.querySelector(q);
  const s = () => store.settings;

  function render() {
    el.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b.dataset.s === sec));
    const body = $('#s-body');
    if (sec === 'negocio') {
      body.innerHTML = `<form class="card stack" id="f-biz">
        <div class="form-grid">
          <div class="field full"><label>Nombre del negocio</label><input class="input" name="businessName" value="${esc(s().businessName || store.tenant?.name || '')}" placeholder="Ej.: Perros El Gordo"></div>
          <div class="field"><label>RIF</label><input class="input" name="rif" value="${esc(s().rif)}" placeholder="J-12345678-9"></div>
          <div class="field"><label>Teléfono</label><input class="input" name="phone" value="${esc(s().phone)}" placeholder="0414-1234567"></div>
          <div class="field full"><label>Dirección</label><input class="input" name="address" value="${esc(s().address)}"></div>
          <div class="field"><label>Instagram</label><input class="input" name="instagram" value="${esc(s().instagram)}" placeholder="@tunegocio"></div>
          <div class="field"><label>Formato del recibo</label><select class="select" name="receiptFormat">${[['80mm', 'Ticket 80 mm'], ['58mm', 'Ticket 58 mm'], ['carta', 'Hoja carta']].map(([v, l]) => `<option value="${v}" ${s().receiptFormat === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div class="field full"><label>Mensaje al pie del recibo</label><input class="input" name="receiptFooter" value="${esc(s().receiptFooter)}"></div>
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div>
      </form>
      <div class="card mt-lg between row-wrap"><div><div class="bold">Tema de la aplicación</div><div class="small muted">Claro u oscuro, según tu preferencia.</div></div><button class="btn btn-secondary" id="s-theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')} Cambiar tema</button></div>`;
      $('#f-biz').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        const patch = {}; for (const k of ['businessName', 'rif', 'phone', 'address', 'instagram', 'receiptFormat', 'receiptFooter']) patch[k] = F[k].value.trim();
        await store.saveSettings(patch);
        if (patch.businessName && patch.businessName !== store.tenant?.name && !store.isDemo) updateTenant(store.tenantId, { name: patch.businessName, updatedAt: nowISO() }).catch(() => {});
        toast('Datos del negocio guardados');
      };
      $('#s-theme').onclick = (e) => { const n = toggleTheme(); e.currentTarget.innerHTML = `${icon(n === 'dark' ? 'sun' : 'moon')} Cambiar tema`; };
    }
    if (sec === 'ventas') {
      body.innerHTML = `<div class="card between row-wrap mb"><div><div class="bold">Tasa del día: Bs ${num(store.rate)} por $1</div><div class="small muted">${s().rateAuto !== false ? 'Se actualiza automáticamente con la tasa oficial BCV cada día.' : 'Tasa manual.'}</div></div><button class="btn btn-secondary" id="s-rate">${icon('refresh')} Cambiar tasa</button></div>
      <form class="card stack" id="f-sales">
        <div class="form-grid">
          <div class="field"><label>IVA incluido en los precios (%)</label><input class="input" name="iva" inputmode="decimal" value="${num(s().iva || 0, 0)}"><span class="hint">Solo se muestra desglosado en el recibo. 0 para no mostrarlo.</span></div>
          <div class="field"><label>Costo de delivery por defecto ($)</label><input class="input" name="deliveryFee" inputmode="decimal" value="${num(s().deliveryFee || 0)}"></div>
        </div>
        <label class="check box box-white"><span class="switch"><input type="checkbox" name="allowNoStock" ${s().allowNoStock ? 'checked' : ''}><span></span></span><span><b>Permitir vender sin stock</b><br><small class="muted">Si está apagado, no se puede vender un producto cuyos ingredientes se agotaron.</small></span></label>
        <label class="check box box-white"><span class="switch"><input type="checkbox" name="printKitchen" ${s().printKitchen ? 'checked' : ''}><span></span></span><span><b>Imprimir comanda automáticamente</b><br><small class="muted">Al enviar a cocina se imprime el ticket de cocina.</small></span></label>
        <div class="row" style="justify-content:flex-end"><button class="btn btn-primary">${icon('check')} Guardar</button></div>
      </form>`;
      $('#s-rate').onclick = openRateModal;
      $('#f-sales').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        await store.saveSettings({ iva: parseNum(F.iva.value), deliveryFee: parseNum(F.deliveryFee.value), allowNoStock: F.allowNoStock.checked, printKitchen: F.printKitchen.checked });
        toast('Configuración de ventas guardada');
      };
    }
    if (sec === 'mesas') {
      body.innerHTML = `<div class="grid-2">
        ${listEditor('zones', 'Zonas del local', 'Ej.: Salón, Terraza, Barra', s().zones)}
        ${listEditor('staff', 'Meseros / cajeros', 'Nombre', s().staff, 'Aparecen al tomar pedidos para saber quién atendió.')}
        ${listEditor('ingredientCategories', 'Categorías de insumos', 'Ej.: Panes y masas', s().ingredientCategories)}
      </div>`;
      for (const key of ['zones', 'staff', 'ingredientCategories']) bindList(key);
    }
    if (sec === 'seguridad') {
      body.innerHTML = `<div class="grid-2">
        <form class="card stack" id="f-pin"><div class="card-title">${icon('lock')} PIN de administrador</div><p class="small muted" style="margin:0">Protege reportes, anulaciones, cancelaciones, mermas, ajustes, gastos y cierre de caja.</p>
          <div class="field"><label>Nuevo PIN (4 a 12 dígitos)</label><input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <div class="field"><label>Repetir PIN</label><input class="input" name="pin2" type="password" inputmode="numeric" maxlength="12" autocomplete="new-password"></div>
          <button class="btn btn-primary">${icon('check')} Cambiar PIN</button></form>
        ${session.user?.isAnonymous ? `<div class="card"><div class="card-title">${icon('shield')} Contraseña</div><p class="muted">En la demo no hay contraseña. Contrata SANO Restaurant para tener tu propia cuenta.</p><a class="btn btn-whatsapp" href="${salesWa()}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>`
          : `<form class="card stack" id="f-pass"><div class="card-title">${icon('shield')} Contraseña de acceso</div>
          <div class="field"><label>Contraseña actual</label><input class="input" name="cur" type="password" autocomplete="current-password"></div>
          <div class="field"><label>Nueva contraseña (mínimo 8)</label><input class="input" name="next" type="password" autocomplete="new-password"></div>
          <div class="error-msg" data-err></div>
          <button class="btn btn-primary">${icon('check')} Cambiar contraseña</button></form>`}
      </div>`;
      $('#f-pin').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        if (store.isDemo) { toast('En la demo el PIN siempre es 1234.', 'info'); return; }
        if (!/^\d{4,12}$/.test(F.pin.value)) { toast('El PIN debe tener de 4 a 12 dígitos', 'warning'); return; }
        if (F.pin.value !== F.pin2.value) { toast('Los PIN no coinciden', 'warning'); return; }
        if (store.hasPin() && !(await requirePin('Cambiar el PIN'))) return;
        await store.setPin(F.pin.value); e.target.reset(); toast('PIN actualizado');
      };
      const fp = $('#f-pass');
      if (fp) fp.onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements; const err = fp.querySelector('[data-err]'); err.textContent = '';
        if (F.next.value.length < 8) { err.textContent = 'La nueva contraseña debe tener al menos 8 caracteres.'; return; }
        const btn = fp.querySelector('button'); setBusy(btn, true);
        try { await changePassword(F.cur.value, F.next.value); e.target.reset(); toast('Contraseña actualizada'); }
        catch (ex) { err.textContent = authErrorMessage(ex); }
        setBusy(btn, false);
      };
    }
    if (sec === 'apps') {
      body.innerHTML = `<div class="grid-2">
        <div class="card stack"><div class="card-title">${icon('install')} Instalar la app</div>
          <p class="small muted" style="margin:0">Instala SANO Restaurant desde el navegador en cada teléfono, tablet o computadora del negocio. Es el mismo sistema, conectado en tiempo real, con su propio ícono y ventana.</p>
          ${isStandalone() ? `<div class="pay-status ok"><span>${icon('check')} Estás usando la app instalada</span><span></span></div>` : `<button class="btn btn-primary btn-lg" data-install>${icon('install')} Instalar en este equipo</button>`}
          <div class="list">
            <div class="list-item"><span class="kpi-icon tone-success" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>Android</b><div class="t-sub">Chrome › menú ⋮ › Instalar app</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-info" style="width:34px;height:34px">${icon('grid')}</span><div class="grow"><b>Computadora</b><div class="t-sub">Chrome o Edge › ícono de instalar en la barra de direcciones</div></div></div>
            <div class="list-item"><span class="kpi-icon tone-violet" style="width:34px;height:34px">${icon('phone')}</span><div class="grow"><b>iPhone / iPad</b><div class="t-sub">Safari › Compartir › Agregar a inicio</div></div></div>
          </div>
          <div class="small muted">${icon('print')} Los recibos y comandas se imprimen desde la app con la impresora configurada en el equipo.</div></div>
        <div class="card stack"><div class="card-title">${icon('download')} Respaldo de datos</div>
          <p class="small muted" style="margin:0">Descarga una copia de tu menú, insumos, mesas y clientes en un archivo.</p>
          <button class="btn btn-secondary" id="s-backup">${icon('download')} Descargar respaldo</button>
          <div class="divider"></div>
          <div class="card-title">${icon('whatsapp')} Soporte</div>
          <p class="small muted" style="margin:0">¿Dudas o sugerencias? Escríbenos.</p>
          <a class="btn btn-whatsapp" href="${salesWa('Hola, necesito soporte con SANO Restaurant.')}" target="_blank" rel="noopener">${icon('whatsapp')} ${SALES_PHONE_FMT}</a></div>
      </div>`;
      bindInstallButtons(body);
      $('#s-backup').onclick = () => {
        const data = { app: 'SANO Restaurant', exportedAt: nowISO(), business: store.businessName, settings: store.settings, ingredients: store.ingredients, products: store.products, tables: store.tables, customers: store.customers };
        download(`respaldo-${(store.businessName || 'sano').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2), 'application/json');
        toast('Respaldo descargado');
      };
    }
  }

  function listEditor(key, title, ph, items, hint = '') {
    return `<div class="card stack" data-list="${key}"><div class="card-title">${title}</div>${hint ? `<div class="small muted">${hint}</div>` : ''}
      <div class="stack-sm" data-items>${items.map((v, i) => `<div class="row" style="padding:6px 10px;border:1px solid var(--border);border-radius:10px"><span class="grow">${esc(v)}</span><button class="btn btn-ghost btn-icon btn-sm" data-rm="${i}">${icon('x')}</button></div>`).join('') || '<span class="small faint">Vacío</span>'}</div>
      <div class="row"><input class="input" data-new placeholder="${esc(ph)}"><button class="btn btn-secondary" data-add>${icon('plus')}</button></div></div>`;
  }
  function bindList(key) {
    const box = el.querySelector(`[data-list="${key}"]`);
    const save = async (list) => { await store.saveSettings({ [key]: list }); render(); };
    box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => {
      const list = [...s()[key]]; const v = list[+b.dataset.rm];
      if (key === 'zones' && store.tables.some((t) => t.zone === v)) { toast('Hay mesas en esa zona. Muévelas primero.', 'warning'); return; }
      list.splice(+b.dataset.rm, 1); save(list);
    });
    const add = () => { const v = box.querySelector('[data-new]').value.trim(); if (!v) return; if (s()[key].includes(v)) { toast('Ya existe', 'warning'); return; } save([...s()[key], v]); };
    box.querySelector('[data-add]').onclick = add;
    box.querySelector('[data-new]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  }

  el.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { sec = b.dataset.s; render(); });
  render();
  return store.on('rate', () => { if (sec === 'ventas') render(); });
}

