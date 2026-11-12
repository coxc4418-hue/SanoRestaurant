// SANO Restaurant — País y moneda de trabajo (se elige la primera vez que se entra).
// Venezuela: dólares con su equivalente en bolívares a la tasa oficial del BCV (como siempre).
// Otros países: su moneda local, sus formas de pago y su código telefónico; sin bolívares ni tasa.
import { store } from './store.js';
import { db, collection, doc, getDocs, writeBatch } from './firebase.js';
import { COUNTRIES, USD_FX, applyLocale, loc, esc, toast, setBusy, openModal, flagImg, round2 } from './utils.js';
import { icon } from './icons.js';

export function openCountryPicker({ force = false } = {}) {
  return new Promise((resolve) => {
    let picked = store.settings.country || (force ? 'VE' : '');
    const list = Object.entries(COUNTRIES).sort((a, b) => a[1].name.localeCompare(b[1].name, 'es'));
    const m = openModal({
      title: force ? '¿En qué país está tu negocio?' : 'País y moneda', size: 'md', dismissible: !force,
      sub: 'Según el país, SANO Restaurant trabaja con su moneda, sus formas de pago y el código telefónico para WhatsApp.',
      body: `<div class="stack"><label class="search">${icon('search')}<input data-q placeholder="Buscar país…" autocomplete="off"></label><div class="country-grid" data-l></div><div data-cur></div><div class="error-msg" data-err></div></div>`,
      footer: `${force ? '' : '<button class="btn btn-secondary" data-close>Cancelar</button>'}<button class="btn btn-primary btn-lg" data-ok disabled>Continuar</button>`,
      onClose: () => resolve(picked && store.settings.country === picked ? picked : null)
    });
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const draw = (qv = '') => {
      const t = norm(qv);
      m.el.querySelector('[data-l]').innerHTML = list.filter(([, c]) => !t || norm(c.name).includes(t)).map(([k, c]) =>
        `<button type="button" class="country ${picked === k ? 'on' : ''}" data-c="${k}"><span class="flag">${flagImg(k, 24)}</span><span class="grow"><b>${esc(c.name)}</b><small>${k === 'VE' ? 'Dólar + bolívar (tasa BCV)' : `${esc(c.curName)} · ${esc(c.sym)}`}</small></span></button>`).join('');
      m.el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { picked = b.dataset.c; draw(m.el.querySelector('[data-q]').value); });
      const c = COUNTRIES[picked];
      m.el.querySelector('[data-cur]').innerHTML = c ? `<div class="card stack" style="padding:12px 14px"><div class="row" style="gap:10px"><span class="flag">${flagImg(picked, 30)}</span><div class="grow"><b>${esc(c.name)}</b>
        <div class="small muted">${picked === 'VE' ? 'Precios en <b>dólares ($)</b> con su equivalente en <b>bolívares</b> a la <b>tasa oficial del BCV</b>, que se actualiza sola cada día. Pagos en efectivo $ y Bs, punto, pago móvil, transferencia, Biopago y Zelle.' : `Moneda: <b>${esc(c.curName)} (${esc(c.sym)})</b> · Formas de pago: efectivo, tarjetas, transferencia${(c.extra || []).length ? ' y otras locales' : ''} · WhatsApp +${esc(c.dial)}`}</div></div></div>
        ${store.settings.country && store.settings.country !== picked && !store.isDemo ? `<div class="small" style="color:var(--warning)">Los montos ya registrados no se convierten: revisa los precios después de cambiar de país.</div>` : ''}</div>` : '';
      m.el.querySelector('[data-ok]').disabled = !picked;
    };
    m.el.querySelector('[data-q]').oninput = (e) => draw(e.target.value);
    m.el.querySelector('[data-ok]').onclick = async (e) => {
      if (!picked) return;
      setBusy(e.currentTarget, true, 'Guardando…');
      try {
        if (store.isDemo && picked !== 'VE' && store.settings.country !== picked) await convertDemo(picked);
        await store.setCountry(picked);
        toast(picked === 'VE' ? 'Listo: trabajarás en dólares con la tasa BCV' : `Listo: trabajarás en ${loc().curName} (${loc().sym})`);
        m.close();
      } catch (ex) { m.el.querySelector('[data-err]').textContent = ex.message; setBusy(e.currentTarget, false); }
    };
    draw();
  });
}

// ---------- Demo en otro país: convierte los datos de ejemplo (hechos en $) a la moneda local ----------
const MONEY = new Set(['amount', 'balance', 'basePrice', 'bulkPrice', 'changeUSD', 'cost', 'creditLimit', 'creditUSD', 'deliveryFee', 'discount', 'due', 'expensesUSD', 'inUSD', 'openingUSD', 'outUSD',
  'paid', 'paidUSD', 'prepaid', 'price', 'prices', 'received', 'salesTotal', 'subtotal', 'tip', 'total', 'totalSpent', 'unitPrice', 'usd', 'efectivo_usd', 'efectivo_bs', 'punto', 'pagomovil', 'transferencia', 'biopago', 'zelle', 'credito',
  'expectedUSD', 'countedUSD', 'diffUSD', 'deposit', 'labor', 'fee', 'debt', 'totalUSD', 'amountUSD']);
const ZERO = new Set(['inBs', 'outBs', 'openingBs', 'totalBs', 'expectedBs', 'countedBs', 'diffBs', 'amountBs']);
const MAP_METHOD = { efectivo_bs: 'efectivo_usd', punto: 'debito', biopago: 'debito', pagomovil: 'transferencia', zelle: 'transferencia' };
const isPlain = (o) => o && typeof o === 'object' && !Array.isArray(o) && typeof o.toMillis !== 'function' && Object.getPrototypeOf(o) === Object.prototype;

export async function convertDemo(code) {
  const { DATA_COLLECTIONS } = await import('./demo.js');
  const c = COUNTRIES[code];
  const F = USD_FX[c.cur] || 1;
  const R = (v) => (c.dec === 0 ? Math.round(v * F) : round2(v * F));
  const VR = Number(store.settings.rate) || 0; // tasa en Bs de los datos de ejemplo
  const conv = (o, inMoney = false) => {
    if (Array.isArray(o)) return o.map((x) => (typeof x === 'number' ? (inMoney ? R(x) : x) : conv(x, inMoney)));
    if (!isPlain(o)) return o;
    const out = {};
    const rate = Number(o.rate) || 0;
    for (const [k, v] of Object.entries(o)) {
      if (ZERO.has(k) && typeof v === 'number') { out[k] = 0; continue; }
      if (k === 'amount' && typeof v === 'number' && (o.currency === 'BS' || o.cur === 'BS')) { out[k] = R(typeof o.usd === 'number' ? o.usd : rate > 0 ? v / rate : VR > 0 ? v / VR : v); continue; }
      if ((k === 'currency' || k === 'cur' || k === 'changeCurrency') && v === 'BS') { out[k] = 'USD'; continue; }
      if ((k === 'rate' || k === 'rateAtOpen' || k === 'rateAtClose') && typeof v === 'number') { out[k] = 1; continue; }
      if ((k === 'method' || k === 'payMethod') && MAP_METHOD[v]) { out[k] = MAP_METHOD[v]; continue; }
      if (typeof v === 'number') { out[k] = MONEY.has(k) ? R(v) : v; continue; }
      if (k === 'prices' && Array.isArray(v)) { out[k] = conv(v, true); continue; }
      out[k] = conv(v);
    }
    // Montos de caja en Bs: pasan a la moneda local y se suman a su par en $
    for (const [bsK, usdK] of [['inBs', 'inUSD'], ['outBs', 'outUSD'], ['openingBs', 'openingUSD'], ['expectedBs', 'expectedUSD'], ['countedBs', 'countedUSD'], ['diffBs', 'diffUSD']]) {
      if (typeof o[bsK] === 'number' && o[bsK] && VR > 0 && typeof o[usdK] === 'number') out[usdK] = R(o[usdK] + o[bsK] / VR);
    }
    // Totales por forma de pago: une los métodos venezolanos en los del país
    if (k_isMethodMap(out)) for (const [from, to] of Object.entries(MAP_METHOD)) if (typeof out[from] === 'number') { out[to] = round2((out[to] || 0) + out[from]); delete out[from]; }
    return out;
  };
  for (const col of DATA_COLLECTIONS) {
    let snap;
    try { snap = await getDocs(collection(db, 'tenants', store.tenantId, col)); } catch (_) { continue; }
    const docs = snap.docs.filter((d) => !(col === 'config' && d.id === 'security'));
    for (let i = 0; i < docs.length; i += 80) {
      const b = writeBatch(db);
      docs.slice(i, i + 80).forEach((d) => {
        const data = conv(d.data());
        if (col === 'config' && d.id === 'settings') { data.rate = 0; data.rateParallel = 0; }
        b.set(doc(db, 'tenants', store.tenantId, col, d.id), data);
      });
      await b.commit();
    }
  }
}
function k_isMethodMap(o) { return Object.keys(o).some((k) => k in MAP_METHOD) && Object.values(o).every((v) => typeof v === 'number'); }
