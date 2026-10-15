// SANO Restaurant — Caja por turnos
import { store } from '../store.js';
import { openShift, closeShift, cashMovement, shiftExpected } from '../ops.js';
import { requirePin } from '../auth.js';
import { esc, usd, bs, num, toast, openModal, emptyState, parseNum, setBusy, fmtDateTime, fmtTime, PAY_METHODS, methodLabel } from '../utils.js';
import { icon } from '../icons.js';
import { printDoc } from '../shared.js';

const EXPENSE_CATS = ['Compras de insumos', 'Gas', 'Servicios', 'Sueldos y pagos', 'Delivery', 'Mantenimiento', 'Retiro del dueño', 'Otros'];
const INCOME_CATS = ['Fondo adicional', 'Otros ingresos'];

export function mount(el) {
  let moves = [];
  let history = null;

  el.innerHTML = `<div class="view-header"><div><h1 class="view-title">Caja</h1><p class="view-sub" id="k-sub"></p></div><div class="view-actions" id="k-actions"></div></div><div id="k-body"></div>`;
  const $ = (s) => el.querySelector(s);

  async function loadMoves() {
    if (!store.openShift) { moves = []; return; }
    try { moves = (await store.listEq('cash_movements', 'shiftId', store.openShift.id)).sort((a, b) => (b.date || '').localeCompare(a.date || '')); } catch (_) { moves = []; }
  }

  function render() {
    const sh = store.openShift;
    if (!sh) {
      $('#k-sub').textContent = 'La caja está cerrada.';
      $('#k-actions').innerHTML = `<button class="btn btn-secondary" id="k-hist">${icon('clock')} Cierres anteriores</button>`;
      $('#k-body').innerHTML = `<div class="card" style="max-width:560px;margin:20px auto">
        <div class="center stack" style="align-items:center;padding:12px 0">
          <div class="kpi-icon tone-brand" style="width:64px;height:64px;border-radius:20px">${icon('wallet')}</div>
          <h2 style="margin:0">Abrir caja</h2>
          <p class="muted" style="margin:0">Indica el efectivo con el que empiezas el turno (fondo para dar vuelto).</p>
        </div>
        <form class="stack" id="k-open">
          <div class="form-grid"><div class="field"><label>Efectivo en dólares</label><div class="input-group"><span class="prefix">$</span><input class="input input-lg" name="usd" inputmode="decimal" placeholder="0,00" autofocus></div></div>
          <div class="field"><label>Efectivo en bolívares</label><div class="input-group"><span class="prefix">Bs</span><input class="input input-lg" style="padding-left:36px" name="bs" inputmode="decimal" placeholder="0,00"></div></div></div>
          <div class="field"><label>Nota (opcional)</label><input class="input" name="note" placeholder="Ej.: turno mañana"></div>
          <button class="btn btn-primary btn-lg btn-block">${icon('unlock')} Abrir caja</button>
        </form></div>`;
      $('#k-open').onsubmit = async (e) => {
        e.preventDefault(); const F = e.target.elements;
        setBusy(e.target.querySelector('button'), true);
        try { await openShift({ openingUSD: parseNum(F.usd.value), openingBs: parseNum(F.bs.value), note: F.note.value.trim() }); toast('Caja abierta. ¡Buenas ventas!'); }
        catch (ex) { toast(ex.message, 'danger'); setBusy(e.target.querySelector('button'), false); }
      };
      $('#k-hist').onclick = showHistory;
      return;
    }
    const exp = shiftExpected(sh);
    const byM = sh.byMethod || {};
    $('#k-sub').innerHTML = `Turno ${esc(sh.number)} · abierto ${fmtDateTime(sh.openedAt)}`;
    $('#k-actions').innerHTML = `<button class="btn btn-secondary" id="k-hist">${icon('clock')} Cierres</button><button class="btn btn-secondary" id="k-out">${icon('arrowUp')} Gasto</button><button class="btn btn-secondary" id="k-in">${icon('arrowDown')} Ingreso</button><button class="btn btn-primary" id="k-close">${icon('lock')} Cerrar caja</button>`;
    $('#k-body').innerHTML = `
      <div class="kpis">
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Ventas del turno</span><span class="kpi-icon tone-success">${icon('trend')}</span></div><div class="kpi-value">${usd(sh.salesTotal || 0)}</div><div class="kpi-sub">${sh.salesCount || 0} venta(s) · ${bs((sh.salesTotal || 0) * store.rate)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Efectivo $ esperado</span><span class="kpi-icon tone-brand">${icon('dollar')}</span></div><div class="kpi-value">${usd(exp.usd)}</div><div class="kpi-sub">fondo ${usd(sh.openingUSD)} + entradas − salidas</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Efectivo Bs esperado</span><span class="kpi-icon tone-info">${icon('cash')}</span></div><div class="kpi-value" style="font-size:22px">${bs(exp.bs)}</div><div class="kpi-sub">fondo ${bs(sh.openingBs)}</div></div>
        <div class="card kpi"><div class="kpi-top"><span class="kpi-label">Gastos del turno</span><span class="kpi-icon tone-danger">${icon('arrowUp')}</span></div><div class="kpi-value">${usd(sh.expensesUSD || 0)}</div><div class="kpi-sub">${sh.tipsTotal ? `Propinas ${usd(sh.tipsTotal)}` : 'pagados desde la caja'}</div></div>
      </div>
      <div class="grid-2">
        <div class="card"><div class="card-head"><div class="card-title">${icon('card')} Ventas por forma de pago</div></div>
          ${Object.keys(PAY_METHODS).filter((k) => byM[k]).length ? Object.entries(PAY_METHODS).filter(([k]) => byM[k]).map(([k, p]) => `<div class="hbar"><span class="row"><i style="width:10px;height:10px;border-radius:50%;background:${p.color}"></i>${p.label}</span><div class="track"><i style="width:${Math.min(100, byM[k] / Math.max(...Object.values(byM)) * 100)}%;background:${p.color}"></i></div><b class="num">${usd(byM[k])}</b></div>`).join('') : emptyState('card', 'Aún no hay ventas en este turno')}
          <div class="small muted mt">Montos expresados en dólares equivalentes.</div></div>
        <div class="card card-flush"><div class="card-head" style="padding:16px 18px 0"><div class="card-title">${icon('list')} Movimientos manuales</div></div>
          <div id="k-moves">${moves.length ? `<div class="table-wrap"><table class="table"><tbody>${moves.map((mv) => `<tr><td class="small nowrap">${fmtTime(mv.date)}</td><td><b>${esc(mv.concept || mv.category)}</b><div class="t-sub">${esc(mv.category || '')}${mv.note ? ' · ' + esc(mv.note) : ''}</div></td><td class="r num ${mv.direction === 'out' ? 'text-danger' : 'text-success'}">${mv.type === 'void' ? 'Anulación' : (mv.direction === 'out' ? '−' : '+') + (mv.currency === 'BS' ? bs(mv.amount) : usd(mv.amount))}</td></tr>`).join('')}</tbody></table></div>` : `<div style="padding:10px">${emptyState('wallet', 'Sin movimientos', 'Registra gastos (gas, compras, pagos) o ingresos extra.')}</div>`}</div></div>
      </div>`;
    $('#k-hist').onclick = showHistory;
    $('#k-out').onclick = () => movementModal('out');
    $('#k-in').onclick = () => movementModal('in');
    $('#k-close').onclick = closeModal;
  }

  function movementModal(direction) {
    const cats = direction === 'out' ? EXPENSE_CATS : INCOME_CATS;
    let cur = 'USD';
    const m = openModal({
      title: direction === 'out' ? 'Registrar gasto' : 'Registrar ingreso', size: 'sm',
      body: `<form class="stack" data-f>
        <div class="seg seg-block"><button type="button" class="on" data-c="USD">Dólares</button><button type="button" data-c="BS">Bolívares</button></div>
        <div class="field"><label>Monto</label><input class="input input-lg" name="amount" inputmode="decimal" placeholder="0,00" autofocus></div>
        <div class="field"><label>Categoría</label><select class="select" name="cat">${cats.map((c) => `<option>${c}</option>`).join('')}</select></div>
        <div class="field"><label>Concepto</label><input class="input" name="concept" placeholder="${direction === 'out' ? 'Ej.: bombona de gas' : 'Ej.: fondo para vuelto'}"></div>
        <div class="error-msg" data-err></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Registrar</button>`
    });
    m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cur = b.dataset.c; m.el.querySelectorAll('[data-c]').forEach((x) => x.classList.toggle('on', x === b)); });
    const F = m.el.querySelector('[data-f]').elements;
    const save = async (e) => {
      e?.preventDefault();
      const amount = parseNum(F.amount.value);
      if (!(amount > 0)) { m.el.querySelector('[data-err]').textContent = 'Indica el monto.'; return; }
      if (direction === 'out' && !(await requirePin('Registrar un gasto'))) return;
      try { await cashMovement({ direction, currency: cur, amount, concept: F.concept.value.trim() || F.cat.value, category: F.cat.value }); m.close(); toast('Movimiento registrado'); await loadMoves(); render(); }
      catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; }
    };
    m.el.querySelector('[data-f]').onsubmit = save;
    m.el.querySelector('[data-ok]').onclick = save;
  }

  async function closeModal() {
    if (!(await requirePin('Cerrar la caja'))) return;
    const sh = store.openShift;
    const exp = shiftExpected(sh);
    const open = store.orders.length;
    const m = openModal({
      title: 'Cerrar caja', sub: 'Cuenta el efectivo físico y escríbelo. El sistema calcula la diferencia.', size: 'md',
      body: `<form class="stack" data-f>
        ${open ? `<div class="pay-status due"><span>${icon('alert')} Hay ${open} pedido(s) abiertos sin cobrar</span><span></span></div>` : ''}
        <div class="form-grid">
          <div class="field"><label>Efectivo $ contado</label><div class="input-group"><span class="prefix">$</span><input class="input input-lg" name="usd" inputmode="decimal" placeholder="${num(exp.usd)}" autofocus></div><span class="hint">Esperado: ${usd(exp.usd)}</span></div>
          <div class="field"><label>Efectivo Bs contado</label><div class="input-group"><span class="prefix">Bs</span><input class="input input-lg" style="padding-left:36px" name="bs" inputmode="decimal" placeholder="${num(exp.bs)}"></div><span class="hint">Esperado: ${bs(exp.bs)}</span></div>
        </div>
        <div class="summary-box" data-diff></div>
        <div class="field"><label>Observación</label><input class="input" name="note" placeholder="Opcional"></div>
      </form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('lock')} Cerrar caja</button>`
    });
    const F = m.el.querySelector('[data-f]').elements;
    const diff = () => {
      const du = (F.usd.value ? parseNum(F.usd.value) : exp.usd) - exp.usd; const db = (F.bs.value ? parseNum(F.bs.value) : exp.bs) - exp.bs;
      const fmt = (v, f) => `<b class="${Math.abs(v) < 0.01 ? 'text-success' : v < 0 ? 'text-danger' : 'text-warning'}">${v > 0 ? '+' : ''}${f(v)}</b>`;
      m.el.querySelector('[data-diff]').innerHTML = `<div class="summary-row"><span>Diferencia en $</span>${fmt(du, usd)}</div><div class="summary-row"><span>Diferencia en Bs</span>${fmt(db, bs)}</div>`;
    };
    F.usd.oninput = diff; F.bs.oninput = diff; diff();
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      setBusy(e.currentTarget, true);
      const countedUSD = F.usd.value ? parseNum(F.usd.value) : exp.usd; const countedBs = F.bs.value ? parseNum(F.bs.value) : exp.bs;
      await closeShift(sh, { countedUSD, countedBs, note: F.note.value.trim() });
      m.close();
      toast('Caja cerrada');
      printClose({ ...sh, ...{ closedAt: new Date().toISOString(), expectedUSD: exp.usd, expectedBs: exp.bs, countedUSD, countedBs, diffUSD: countedUSD - exp.usd, diffBs: countedBs - exp.bs } }, true);
    };
  }

  function printClose(sh, ask = false) {
    const go = () => printDoc(`Cierre de caja ${sh.number}`, `
      <div class="kpis"><div class="kpi">Apertura<b>${fmtDateTime(sh.openedAt)}</b></div><div class="kpi">Cierre<b>${fmtDateTime(sh.closedAt)}</b></div><div class="kpi">Ventas<b>$${num(sh.salesTotal || 0)}</b>${sh.salesCount || 0} ventas</div></div>
      <h2>Efectivo</h2><table><thead><tr><th></th><th class="r">Dólares</th><th class="r">Bolívares</th></tr></thead><tbody>
      <tr><td>Fondo inicial</td><td class="r">$${num(sh.openingUSD)}</td><td class="r">Bs ${num(sh.openingBs)}</td></tr>
      <tr><td>Entradas</td><td class="r">$${num(sh.inUSD)}</td><td class="r">Bs ${num(sh.inBs)}</td></tr>
      <tr><td>Salidas (vueltos y gastos)</td><td class="r">$${num(sh.outUSD)}</td><td class="r">Bs ${num(sh.outBs)}</td></tr>
      <tr><td><b>Esperado</b></td><td class="r"><b>$${num(sh.expectedUSD)}</b></td><td class="r"><b>Bs ${num(sh.expectedBs)}</b></td></tr>
      <tr><td><b>Contado</b></td><td class="r"><b>$${num(sh.countedUSD)}</b></td><td class="r"><b>Bs ${num(sh.countedBs)}</b></td></tr>
      <tr><td><b>Diferencia</b></td><td class="r">$${num(sh.diffUSD)}</td><td class="r">Bs ${num(sh.diffBs)}</td></tr></tbody></table>
      <h2>Ventas por forma de pago (en $)</h2><table><tbody>${Object.entries(sh.byMethod || {}).filter(([, v]) => v).map(([k, v]) => `<tr><td>${esc(methodLabel(k))}</td><td class="r">$${num(v)}</td></tr>`).join('') || '<tr><td>Sin ventas</td><td></td></tr>'}</tbody></table>
      ${sh.expensesUSD ? `<p>Gastos del turno: $${num(sh.expensesUSD)}</p>` : ''}${sh.tipsTotal ? `<p>Propinas: $${num(sh.tipsTotal)}</p>` : ''}${sh.closeNote ? `<p>Observación: ${esc(sh.closeNote)}</p>` : ''}`);
    if (!ask) { go(); return; }
    const m = openModal({ title: 'Caja cerrada', size: 'sm', body: `<p class="muted">¿Deseas imprimir el reporte de cierre?</p>`, footer: `<button class="btn btn-secondary" data-close>No</button><button class="btn btn-primary" data-p>${icon('print')} Imprimir</button>` });
    m.el.querySelector('[data-p]').onclick = () => { go(); m.close(); };
  }

  async function showHistory() {
    const m = openModal({ title: 'Cierres de caja', size: 'lg', body: '<div class="empty"><div class="spinner"></div></div>', footer: '<button class="btn btn-primary" data-close>Cerrar</button>' });
    history = await store.closedShifts(40).catch(() => []);
    m.el.querySelector('.modal-body').innerHTML = history.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Turno</th><th>Cierre</th><th class="r">Ventas</th><th class="r">Dif. $</th><th class="r">Dif. Bs</th><th></th></tr></thead><tbody>
      ${history.map((h) => `<tr><td><b>${esc(h.number)}</b></td><td class="small">${fmtDateTime(h.closedAt)}</td><td class="r num">${usd(h.salesTotal || 0)}</td><td class="r num ${Math.abs(h.diffUSD || 0) < 0.01 ? '' : 'text-danger'}">${usd(h.diffUSD || 0)}</td><td class="r num ${Math.abs(h.diffBs || 0) < 0.01 ? '' : 'text-danger'}">${bs(h.diffBs || 0)}</td><td class="r"><button class="btn btn-ghost btn-icon btn-sm" data-pr="${h.id}">${icon('print')}</button></td></tr>`).join('')}
      </tbody></table></div>` : emptyState('clock', 'Aún no hay cierres');
    m.el.querySelectorAll('[data-pr]').forEach((b) => b.onclick = () => printClose(history.find((h) => h.id === b.dataset.pr)));
  }

  loadMoves().then(render);
  render();
  const off = store.on('*', async (evt) => { if (evt === 'shift') { await loadMoves(); render(); } if (evt === 'rate') render(); });
  return off;
}
