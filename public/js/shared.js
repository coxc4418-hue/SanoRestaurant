// SANO Restaurant — Componentes compartidos entre vistas
import { store, unitShort } from './store.js';
import { openModal, toast, num, esc, parseNum, fmtDateTime, setBusy, usd, bs, methodLabel, qtyFmt, printHTML, todayKey, dayKey } from './utils.js';
import { icon } from './icons.js';

export const APP_NAME = 'SANO Restaurant';
export const SALES_PHONE = '584221906045';
export const SALES_PHONE_FMT = '+58 422-190 6045';
export const salesWa = (msg = 'Hola, me interesa SANO Restaurant para mi negocio de comida. ¿Me pueden dar más información?') =>
  `https://wa.me/${SALES_PHONE}?text=${encodeURIComponent(msg)}`;

// ======================================================================
// TASA BCV
// ======================================================================
/** Obtiene la tasa oficial BCV desde un servicio público. */
export async function fetchBcvRate() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const v = Number(j.promedio || j.precio || j.venta);
    if (!(v > 0)) throw new Error('Respuesta inválida');
    return { rate: v, date: j.fechaActualizacion || null };
  } finally { clearTimeout(t); }
}

/** Si la tasa automática está activa y no se actualizó hoy, la consulta y la guarda. */
export async function autoUpdateRate() {
  const s = store.settings;
  if (s.rateAuto === false) return false;
  if (s.rateUpdatedAt && dayKey(new Date(s.rateUpdatedAt)) === todayKey() && store.rate > 0) return false;
  try {
    const r = await fetchBcvRate();
    if (Math.abs(r.rate - store.rate) < 0.0001 && s.rateUpdatedAt && dayKey(new Date(s.rateUpdatedAt)) === todayKey()) return false;
    await store.setRate(Math.round(r.rate * 100) / 100, true);
    toast(`Tasa BCV del día actualizada: Bs ${num(r.rate)}`, 'info', 4000);
    return true;
  } catch (_) { return false; }
}

export function openRateModal() {
  const s = store.settings;
  const m = openModal({
    title: 'Tasa del día',
    sub: s.rateUpdatedAt ? `Última actualización: ${fmtDateTime(s.rateUpdatedAt)} · ${s.rateSource === 'bcv' ? 'automática BCV' : 'manual'}` : 'Configura la tasa para mostrar los precios en bolívares',
    size: 'sm',
    body: `
      <form class="stack" data-f>
        <div class="field">
          <label>Bolívares por 1 $</label>
          <input class="input input-lg" data-rate inputmode="decimal" value="${s.rate ? num(s.rate) : ''}" placeholder="0,00" autofocus>
        </div>
        <button type="button" class="btn btn-secondary btn-block" data-auto>${icon('refresh')} Consultar tasa oficial BCV</button>
        <label class="check"><input type="checkbox" data-autoflag ${s.rateAuto !== false ? 'checked' : ''}> <span>Actualizar automáticamente con la tasa BCV cada día</span></label>
        <div class="hint" data-hint>Puedes escribir cualquier tasa (por ejemplo, la de tu negocio). Se aplica a los precios en Bs, la caja y los reportes.</div>
      </form>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-save>Guardar tasa</button>`
  });
  const input = m.el.querySelector('[data-rate]');
  const hint = m.el.querySelector('[data-hint]');
  m.el.querySelector('[data-auto]').onclick = async (e) => {
    const btn = e.currentTarget;
    setBusy(btn, true, 'Consultando…');
    try {
      const r = await fetchBcvRate();
      input.value = num(r.rate);
      hint.textContent = `Tasa oficial BCV${r.date ? ' (' + fmtDateTime(r.date) + ')' : ''}. Pulsa “Guardar tasa” para aplicarla.`;
    } catch (_) {
      hint.textContent = 'No se pudo consultar la tasa automáticamente. Escríbela manualmente.';
    } finally { setBusy(btn, false); }
  };
  const save = async (e) => {
    e?.preventDefault();
    const v = parseNum(input.value);
    if (!(v > 0)) { toast('Ingresa una tasa válida', 'warning'); input.focus(); return; }
    const autoFlag = m.el.querySelector('[data-autoflag]').checked;
    await store.saveSettings({ rateAuto: autoFlag });
    await store.setRate(v, false);
    toast(`Tasa actualizada: Bs ${num(v)} por $1`);
    m.close();
  };
  m.el.querySelector('[data-f]').onsubmit = save;
  m.el.querySelector('[data-save]').onclick = save;
}

// ======================================================================
// MONEDA
// ======================================================================
export function moneyPair(usdVal, rate = store.rate) {
  return `<b class="num">${usd(usdVal)}</b><span class="small text-bs num" style="display:block">${bs(usdVal * rate)}</span>`;
}
export const toBs = (v) => bs((Number(v) || 0) * store.rate);
/** Costo unitario: muestra 4 decimales cuando es muy pequeño (ej. costo por gramo) */
export const usdUnit = (v) => { const n = Number(v) || 0; return n > 0 && n < 0.1 ? `$ ${num(n, 4)}` : usd(n); };

// ======================================================================
// IMPRESIÓN
// ======================================================================
function ticketCSS(fmt) {
  const width = fmt === '58mm' ? '200px' : fmt === 'carta' ? '100%' : '290px';
  const font = fmt === 'carta' ? '13px' : fmt === '58mm' ? '10.5px' : '11.5px';
  return `@page { margin: ${fmt === 'carta' ? '14mm' : '2mm'}; }
    body { font-family: 'Courier New', monospace; font-size: ${font}; width: ${width}; margin: 0 auto; color: #000; }
    .c { text-align: center; } .b { font-weight: bold; } .hr { border-top: 1px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; } .r { text-align: right; }
    .big { font-size: 1.25em; font-weight: bold; } .xl { font-size: 2em; font-weight: bold; } .sm { font-size: .85em; }`;
}

function headerHTML() {
  const s = store.settings;
  return `<div class="c b" style="font-size:1.3em">${esc(store.businessName)}</div>
    ${s.rif ? `<div class="c">RIF: ${esc(s.rif)}</div>` : ''}
    ${s.address ? `<div class="c">${esc(s.address)}</div>` : ''}
    ${s.phone ? `<div class="c">Tel: ${esc(s.phone)}</div>` : ''}
    ${s.instagram ? `<div class="c">IG: ${esc(s.instagram)}</div>` : ''}`;
}

function linesHTML(items) {
  return (items || []).map((it) => `
    <tr><td colspan="2" style="padding-top:3px">${qtyFmt(it.qty)} x ${esc(it.name)}${it.variantName ? ' (' + esc(it.variantName) + ')' : ''}</td><td class="r">$${num(it.total)}</td></tr>
    ${(it.extras || []).length ? `<tr><td colspan="3" class="sm">  + ${it.extras.map((e) => esc(e.name)).join(', ')}</td></tr>` : ''}
    ${it.note ? `<tr><td colspan="3" class="sm">  * ${esc(it.note)}</td></tr>` : ''}`).join('');
}

export function receiptHTML(sale) {
  const s = store.settings;
  const rate = sale.rate || store.rate;
  const ivaPct = Number(s.iva) || 0;
  const ivaBs = ivaPct > 0 ? (sale.total - sale.total / (1 + ivaPct / 100)) * rate : 0;
  const pays = (sale.payments || []).map((p) => `<tr><td colspan="2">${esc(methodLabel(p.method))}</td><td class="r">${p.currency === 'BS' ? 'Bs ' + num(p.amount) : '$' + num(p.amount)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo ${esc(sale.number)}</title><style>${ticketCSS(s.receiptFormat)}</style></head><body>
    ${headerHTML()}
    <div class="hr"></div>
    <div class="c xl">#${esc(sale.orderNo || '')}</div>
    <div class="c b">${esc(sale.typeLabel || '')}${sale.tableName ? ' · ' + esc(sale.tableName) : ''}</div>
    <div>Recibo: ${esc(sale.number)}</div>
    <div>Fecha: ${fmtDateTime(sale.date)}</div>
    <div>Cliente: ${esc(sale.customerName || 'Mostrador')}</div>
    ${sale.address ? `<div>Dirección: ${esc(sale.address)}</div>` : ''}
    ${sale.waiter ? `<div>Atendido por: ${esc(sale.waiter)}</div>` : ''}
    ${sale.status === 'voided' ? '<div class="c b">*** VENTA ANULADA ***</div>' : ''}
    <div class="hr"></div>
    <table>${linesHTML(sale.items)}</table>
    <div class="hr"></div>
    <table>
      <tr><td colspan="2">Subtotal</td><td class="r">$${num(sale.subtotal)}</td></tr>
      ${sale.discount > 0 ? `<tr><td colspan="2">Descuento</td><td class="r">-$${num(sale.discount)}</td></tr>` : ''}
      ${sale.service > 0 ? `<tr><td colspan="2">Servicio ${num(sale.servicePct, 0)}%</td><td class="r">$${num(sale.service)}</td></tr>` : ''}
      ${sale.delivery > 0 ? `<tr><td colspan="2">Delivery</td><td class="r">$${num(sale.delivery)}</td></tr>` : ''}
      ${sale.tip > 0 ? `<tr><td colspan="2">Propina</td><td class="r">$${num(sale.tip)}</td></tr>` : ''}
      <tr class="big"><td colspan="2">TOTAL $</td><td class="r">$${num(sale.total)}</td></tr>
      <tr class="big"><td colspan="2">TOTAL Bs</td><td class="r">${num(sale.totalBs)}</td></tr>
      <tr><td colspan="3" class="sm">Tasa: Bs ${num(rate)} por $</td></tr>
      ${ivaBs > 0.009 ? `<tr><td colspan="2">IVA ${num(ivaPct, 0)}% incluido</td><td class="r">Bs ${num(ivaBs)}</td></tr>` : ''}
    </table>
    ${pays ? `<div class="hr"></div><table>${pays}</table>` : ''}
    ${sale.changeUSD > 0.009 ? `<div>Vuelto: ${sale.changeCurrency === 'BS' ? 'Bs ' + num(sale.changeUSD * rate) : '$' + num(sale.changeUSD)}</div>` : ''}
    ${sale.note ? `<div>Nota: ${esc(sale.note)}</div>` : ''}
    <div class="hr"></div>
    <div class="c">${esc(s.receiptFooter || '¡Gracias por tu compra!')}</div>
    <div class="c sm" style="margin-top:4px">SANO Restaurant</div>
  </body></html>`;
}
export function printReceipt(sale) { printHTML(receiptHTML(sale)); }

/** Pre-cuenta de una mesa (antes de cobrar) */
export function printPreBill(order, totals) {
  const s = store.settings;
  printHTML(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pre-cuenta</title><style>${ticketCSS(s.receiptFormat)}</style></head><body>
    ${headerHTML()}
    <div class="hr"></div>
    <div class="c big">PRE-CUENTA</div>
    <div class="c b">${esc(order.tableName || '')} · Pedido #${esc(order.orderNo || '')}</div>
    <div>${fmtDateTime(new Date().toISOString())}</div>
    <div class="hr"></div>
    <table>${linesHTML(order.items)}</table>
    <div class="hr"></div>
    <table>
      <tr><td colspan="2">Subtotal</td><td class="r">$${num(totals.subtotal)}</td></tr>
      ${totals.service > 0 ? `<tr><td colspan="2">Servicio</td><td class="r">$${num(totals.service)}</td></tr>` : ''}
      <tr class="big"><td colspan="2">TOTAL $</td><td class="r">$${num(totals.total)}</td></tr>
      <tr class="big"><td colspan="2">TOTAL Bs</td><td class="r">${num(totals.total * store.rate)}</td></tr>
    </table>
    <div class="hr"></div><div class="c sm">Documento no fiscal · Solicite su recibo al pagar</div>
  </body></html>`);
}

/** Comanda para la cocina */
export function printKitchenTicket(t) {
  printHTML(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comanda</title><style>${ticketCSS(store.settings.receiptFormat)}</style></head><body>
    <div class="c xl">#${esc(t.orderNo || '')}</div>
    <div class="c big">${esc(t.label || '')}</div>
    <div class="c">${fmtDateTime(t.createdAt)}${t.round > 1 ? ' · Ronda ' + t.round : ''}</div>
    ${t.waiter ? `<div class="c">Mesero: ${esc(t.waiter)}</div>` : ''}
    <div class="hr"></div>
    ${(t.items || []).map((i) => `<div class="big">${qtyFmt(i.qty)} x ${esc(i.name)}${i.variantName ? ' (' + esc(i.variantName) + ')' : ''}</div>
      ${i.extras?.length ? `<div>  + ${i.extras.map(esc).join(', ')}</div>` : ''}
      ${i.note ? `<div class="b">  * ${esc(i.note)}</div>` : ''}`).join('')}
    ${t.note ? `<div class="hr"></div><div class="b">Nota: ${esc(t.note)}</div>` : ''}
  </body></html>`);
}

/** Documento imprimible genérico (reportes, cierres, lista de compras) */
export function printDoc(title, inner) {
  printHTML(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 2px; } h2 { font-size: 14px; margin: 16px 0 6px; }
    .muted { color: #555; } table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { background: #c2410c; color: #fff; text-align: left; padding: 6px; font-size: 11px; }
    td { padding: 5px 6px; border-bottom: 1px solid #ddd; } .r { text-align: right; }
    .kpis { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .kpi { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; min-width: 140px; }
    .kpi b { display: block; font-size: 15px; }
  </style></head><body>
  <h1>${esc(store.businessName)}</h1>
  <div class="muted">${esc(title)} · Generado ${fmtDateTime(new Date().toISOString())}</div>
  ${inner}
  <p class="muted" style="margin-top:20px;font-size:10px">SANO Restaurant — Sistema para negocios de comida</p>
  </body></html>`);
}

export function stockText(ing) {
  return `${qtyFmt(Math.round((Number(ing.stock) || 0) * 1000) / 1000)} ${unitShort(ing.unit)}`;
}

/** Aviso de stock bajo tras una venta */
export function notifyLowStock(list) {
  if (!list?.length) return;
  const names = list.slice(0, 3).map((i) => `${i.name} (${stockText(i)})`).join(', ');
  toast(`Stock bajo: ${names}${list.length > 3 ? ` y ${list.length - 3} más` : ''}`, 'warning', 6000);
}

export { usd, bs };
