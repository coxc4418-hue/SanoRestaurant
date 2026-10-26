// SANO Restaurant — Recorrido guiado: ilumina zonas de la pantalla y explica para qué sirven
import { esc, openModal, closeAllModals } from './utils.js';
import { icon } from './icons.js';

// Cada paso: { route, sel: [selectores alternativos], title, text }. Sin elemento visible → tarjeta centrada.
export const TOURS = {
  general: {
    name: 'Recorrido general', desc: 'Lo esencial del sistema en 1 minuto', icon: 'sparkle',
    steps: [
      { route: 'inicio', title: '¡Bienvenido a SANO Restaurant! 👋', text: 'Te mostramos en un minuto cómo funciona. Usa “Siguiente” para avanzar o “Salir” cuando quieras. Puedes repetir este recorrido desde el menú › Ayuda.' },
      { route: 'inicio', sel: ['.sb-nav', '.bottom-nav'], title: 'Menú principal', text: 'Desde aquí entras a cada sección: vender, mesas, pedidos, cocina, menú, inventario, caja y reportes. Los números rojos o naranjas son avisos pendientes.' },
      { route: 'inicio', sel: ['#sb-rate', '#tb-rate'], title: 'Tasa del día', text: 'Los precios se guardan en dólares y se muestran en bolívares con esta tasa. Se actualiza sola con la tasa BCV cada mañana y puedes cambiarla tocando aquí.' },
      { route: 'inicio', sel: ['[data-tour="kpis"]'], title: 'Resumen del día', text: 'Ventas de hoy en $ y Bs, cantidad de pedidos, ganancia (ventas menos el costo de los ingredientes) y lo que falta por cobrar.' },
      { route: 'inicio', sel: ['[data-tour="stock"]'], title: 'Alertas de stock', text: 'Cuando un ingrediente baja de su mínimo aparece aquí, con una lista de compras lista para enviar por WhatsApp.' },
      { route: 'vender', sel: ['#pos-grid'], title: 'Vender', text: 'Toca un producto para agregarlo al pedido. Si tiene tamaños (pizza personal o familiar) o extras (queso, tocineta) se abre una ventana para elegirlos. Si se acaban sus ingredientes aparece “Agotado”.' },
      { route: 'vender', sel: ['.cart .seg'], title: 'Tipo de pedido', text: 'Elige si es para llevar, para una mesa o delivery. En delivery puedes anotar la dirección y el costo del envío.' },
      { route: 'vender', sel: ['#c-pay', '#cart-fab'], title: 'Cobrar', text: 'Acepta varias formas de pago a la vez, en dólares y bolívares, y calcula el vuelto. Al cobrar se descuentan solos los ingredientes de cada receta y la comanda llega a la cocina.' },
      { route: 'mesas', sel: ['#t-grid'], title: 'Mesas', text: 'Verde = libre. Naranja = con pedido en cocina. “Para servir” = la cocina ya terminó. Toca una mesa libre para tomar el pedido, o una ocupada para agregar más, ver la pre-cuenta o cobrar.' },
      { route: 'cocina', sel: ['#k-board'], title: 'Cocina', text: 'Las comandas llegan solas con un sonido. El cocinero las pasa de Pendiente a Preparando y a Listo. Así el mesero sabe qué servir.' },
      { route: 'menu', sel: ['#m-list'], title: 'Menú y recetas', text: 'Aquí defines el precio y la receta de cada producto. Ejemplo: Perro caliente = 1 pan + 1 salchicha + 20 g de repollo. También ves el costo, el margen de ganancia y cuántos puedes preparar.' },
      { route: 'inventario', sel: ['#i-kpis'], title: 'Inventario', text: 'Registra tus insumos y sus compras. El sistema calcula el costo promedio, avisa lo que se está acabando y lleva el historial de mermas y ajustes.' },
      { route: 'caja', sel: ['#k-body'], title: 'Caja', text: 'Abre la caja al iniciar el turno con el efectivo de fondo, registra gastos, y al cerrar cuenta el dinero: el sistema te dice si sobra o falta, en $ y en Bs.' },
      { route: 'caja', sel: ['.sb-nav [data-nav="reportes"]'], title: 'Reportes', text: 'Ventas por día y por hora, productos más vendidos, ganancia, formas de pago e ingredientes consumidos. Se exportan a Excel. Están protegidos con el PIN del dueño (en la demo el PIN es 1234).' },
      { route: 'caja', sel: ['.sb-foot [data-install]', '.topbar [data-install]'], title: 'Instala la app', text: 'Instala SANO Restaurant en el teléfono o la computadora desde el navegador: queda con su ícono, abre en su propia ventana y todo se sincroniza.' },
      { route: 'inicio', title: '¡Listo para vender! 🎉', text: 'Prueba ahora: ve a Vender, agrega un perro caliente y cóbralo. Luego mira cómo bajan el pan y la salchicha en Inventario. Encontrarás más recorridos y el video tutorial en el menú › Ayuda.', final: true }
    ]
  },
  vender: {
    name: 'Cómo vender', desc: 'Pedido para llevar, mesa o delivery y cobro', icon: 'cart',
    steps: [
      { route: 'vender', sel: ['#pos-search'], title: 'Buscar', text: 'Escribe el nombre de un producto para encontrarlo rápido. En la computadora puedes presionar F1 para venir a Vender.' },
      { route: 'vender', sel: ['#pos-cats'], title: 'Categorías', text: 'Filtra el menú por categoría: perros, hamburguesas, pizzas, bebidas…' },
      { route: 'vender', sel: ['#pos-grid'], title: 'Productos', text: 'Cada tarjeta muestra el precio en $ y en Bs. “Quedan 3” te avisa que quedan pocos ingredientes; “Agotado” impide venderlo.' },
      { route: 'vender', sel: ['.cart .seg'], title: 'Para llevar, mesa o delivery', text: 'Si eliges Mesa, te pedirá la mesa. En Delivery escribes la dirección y al cobrar se suma el envío.' },
      { route: 'vender', sel: ['#c-cust'], title: 'Cliente', text: 'Asigna un cliente frecuente o crea uno nuevo. Queda su historial de compras y su dirección para el delivery.' },
      { route: 'vender', sel: ['#c-save', '#c-send'], title: 'Cobrar luego / Enviar', text: '“Cobrar luego” guarda el pedido y lo manda a cocina para cobrarlo al entregar. En mesas, “Enviar” manda a cocina lo nuevo y puedes agregar más rondas.' },
      { route: 'vender', sel: ['#c-pay', '#cart-fab'], title: 'Cobrar', text: 'Elige una o varias formas de pago (efectivo $, efectivo Bs, punto, pago móvil, Zelle…). Puedes aplicar un descuento o una propina opcional. Al final imprime el recibo.' }
    ]
  },
  mesas: {
    name: 'Mesas y cocina', desc: 'Tomar pedidos en mesa y seguirlos en cocina', icon: 'table',
    steps: [
      { route: 'mesas', sel: ['#t-zones'], title: 'Zonas', text: 'Separa tus mesas por zona: salón, terraza, barra… Las zonas se configuran en Configuración › Mesas y personal.' },
      { route: 'mesas', sel: ['#t-grid'], title: 'Estado de las mesas', text: 'Cada mesa muestra si está libre, en cocina o lista para servir, con el total consumido y el tiempo desde que se abrió.' },
      { route: 'mesas', sel: ['#t-edit'], title: 'Editar mesas', text: 'Activa la edición para cambiar el nombre, la zona o los puestos de una mesa, o eliminarla.' },
      { route: 'mesas', sel: ['#t-new'], title: 'Nueva mesa', text: 'Agrega mesas cuando quieras. Si estás empezando, puedes crear varias de una vez.' },
      { route: 'cocina', sel: ['.kcol'], title: 'Comandas pendientes', text: 'Cada comanda trae el número del pedido, la mesa o “Para llevar”, los productos con sus extras y las notas (ej. “sin cebolla”).' },
      { route: 'cocina', sel: ['#k-sound'], title: 'Sonido', text: 'Suena un aviso cuando llega una comanda nueva. Úsalo en una tablet o pantalla en la cocina.' }
    ]
  },
  menu: {
    name: 'Menú y recetas', desc: 'Precios, recetas, tamaños y extras', icon: 'burger',
    steps: [
      { route: 'menu', sel: ['#m-new'], title: 'Nuevo producto', text: 'Crea un producto con su precio en dólares, su foto o emoji y su receta: qué ingredientes consume y cuánto de cada uno.' },
      { route: 'menu', sel: ['#m-list'], title: 'Recetas y márgenes', text: 'Para cada producto ves la receta, el costo según lo que pagaste por los ingredientes, el margen de ganancia y cuántas unidades alcanzan con el stock actual.' },
      { route: 'menu', sel: ['#m-list .switch'], title: 'Activo', text: 'Apágalo para ocultar un producto del punto de venta sin borrarlo (por ejemplo, si hoy no hay pizza).' },
      { route: 'menu', sel: ['#m-cats'], title: 'Categorías', text: 'Ordena las categorías como quieres verlas al vender.' }
    ]
  },
  inventario: {
    name: 'Inventario', desc: 'Insumos, compras, mermas y alertas', icon: 'box',
    steps: [
      { route: 'inventario', sel: ['#i-kpis'], title: 'Estado del inventario', text: 'Cuántos insumos tienes, cuáles están bajos o agotados y cuánto vale tu inventario.' },
      { route: 'inventario', sel: ['#i-new'], title: 'Nuevo insumo', text: 'Registra el insumo en la unidad en que lo usas: panes por unidad, queso en rebanadas o gramos, salsas en mililitros. Indica el stock mínimo para recibir alertas.' },
      { route: 'inventario', sel: ['#i-buy'], title: 'Registrar compra', text: 'Cuando compras mercancía, súmala aquí con lo que pagaste: el costo de tus recetas se actualiza solo. Puedes pagarla con dinero de la caja.' },
      { route: 'inventario', sel: ['[data-mv]'], title: 'Mover', text: 'Para cada insumo: compra, merma (lo que se dañó o desperdició) o ajuste por conteo físico.' },
      { route: 'inventario', sel: ['[data-tab="shop"]'], title: 'Lista de compras', text: 'Te sugiere qué comprar y cuánto, y la envías por WhatsApp al proveedor o al encargado.' }
    ]
  },
  caja: {
    name: 'Caja', desc: 'Abrir, gastos y cierre con arqueo', icon: 'wallet',
    steps: [
      { route: 'caja', sel: ['#k-body .kpis', '#k-open'], title: 'Turno de caja', text: 'Muestra las ventas del turno y el efectivo esperado en dólares y en bolívares (fondo + entradas − vueltos y gastos).' },
      { route: 'caja', sel: ['#k-out'], title: 'Gastos', text: 'Registra lo que sale de la caja: gas, compras, pagos al personal… Así el cierre cuadra.' },
      { route: 'caja', sel: ['#k-close'], title: 'Cerrar caja', text: 'Cuenta el efectivo y escríbelo: el sistema calcula si sobra o falta y te da un reporte de cierre para imprimir.' }
    ]
  }
};

let state = null;

const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; };
async function findTarget(sels = [], timeout = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    for (const s of sels) { const el = [...document.querySelectorAll(s)].find(visible); if (el) return el; }
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

/** Inicia un recorrido (por defecto el general). */
export async function startTour(id = 'general') {
  stopTour();
  const tour = TOURS[id];
  if (!tour) return;
  const root = document.createElement('div');
  root.className = 'tour';
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root);
  state = { id, tour, i: 0, root, target: null };
  const onKey = (e) => {
    if (!state) return;
    if (e.key === 'Escape') { e.stopPropagation(); stopTour(); }
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  const onResize = () => place();
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', onResize, true);
  state.cleanup = () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onResize, true); };
  await show();
}

export function stopTour() {
  if (!state) return;
  state.cleanup?.();
  state.root.remove();
  state = null;
  try { localStorage.setItem('sr_tour_done', '1'); } catch (_) {}
}
export const tourActive = () => !!state;

async function go(d) {
  if (!state) return;
  const n = state.i + d;
  if (n < 0) return;
  if (n >= state.tour.steps.length) { stopTour(); return; }
  state.i = n;
  await show();
}

async function show() {
  const s = state.tour.steps[state.i];
  const tip = state.root.querySelector('.tour-tip');
  tip.classList.add('busy');
  const { navigate } = await import('./main.js');
  if (s.route && location.hash.replace(/^#\/?/, '') !== s.route) {
    await navigate(s.route);
    await new Promise((r) => setTimeout(r, 350));
  }
  if (!state) return;
  closeAllModals();
  state.target = s.sel ? await findTarget(s.sel) : null;
  if (!state) return;
  if (state.target) state.target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const total = state.tour.steps.length;
  tip.innerHTML = `
    <div class="tour-step">${state.i + 1} de ${total}</div>
    <div class="tour-title">${esc(s.title)}</div>
    <div class="tour-text">${esc(s.text)}</div>
    <div class="tour-dots">${Array.from({ length: total }, (_, k) => `<i class="${k === state.i ? 'on' : ''}"></i>`).join('')}</div>
    <div class="tour-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-t="stop">${s.final ? 'Cerrar' : 'Salir'}</button>
      <span class="grow"></span>
      ${state.i > 0 ? `<button type="button" class="btn btn-secondary btn-sm" data-t="prev">${icon('arrowLeft')}</button>` : ''}
      ${s.final ? `<button type="button" class="btn btn-secondary btn-sm" data-t="video">${icon('eye')} Ver video</button>` : ''}
      <button type="button" class="btn btn-primary btn-sm" data-t="next">${state.i === total - 1 ? 'Terminar' : 'Siguiente'} ${state.i === total - 1 ? '' : icon('arrowRight')}</button>
    </div>`;
  tip.querySelector('[data-t="stop"]').onclick = stopTour;
  tip.querySelector('[data-t="next"]').onclick = () => go(1);
  const pv = tip.querySelector('[data-t="prev"]'); if (pv) pv.onclick = () => go(-1);
  const vd = tip.querySelector('[data-t="video"]'); if (vd) vd.onclick = () => { stopTour(); openVideo(); };
  tip.classList.remove('busy');
  place();
  tip.querySelector('[data-t="next"]').focus({ preventScroll: true });
}

function place() {
  if (!state) return;
  const spot = state.root.querySelector('.tour-spot');
  const tip = state.root.querySelector('.tour-tip');
  const vw = innerWidth, vh = innerHeight, pad = 8;
  const el = state.target;
  if (!el || !document.contains(el)) {
    spot.style.cssText = `left:${vw / 2}px;top:${vh / 2}px;width:0;height:0;`;
    tip.className = 'tour-tip center';
    tip.style.left = `${Math.max(12, (vw - tip.offsetWidth) / 2)}px`;
    tip.style.top = `${Math.max(12, (vh - tip.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  const x = Math.max(4, r.left - pad), y = Math.max(4, r.top - pad);
  const w = Math.min(vw - x - 4, r.width + pad * 2), h = Math.min(vh - y - 4, r.height + pad * 2);
  spot.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const tw = tip.offsetWidth, th = tip.offsetHeight, gap = 14;
  let left, top, side;
  if (y + h + gap + th <= vh - 8) { side = 'bottom'; top = y + h + gap; left = x + w / 2 - tw / 2; }
  else if (y - gap - th >= 8) { side = 'top'; top = y - gap - th; left = x + w / 2 - tw / 2; }
  else if (x + w + gap + tw <= vw - 8) { side = 'right'; left = x + w + gap; top = y + h / 2 - th / 2; }
  else if (x - gap - tw >= 8) { side = 'left'; left = x - gap - tw; top = y + h / 2 - th / 2; }
  else { side = 'inside'; left = vw / 2 - tw / 2; top = vh - th - 16; }
  left = Math.max(10, Math.min(vw - tw - 10, left));
  top = Math.max(10, Math.min(vh - th - 10, top));
  tip.className = `tour-tip side-${side}`;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// ======================================================================
// Ayuda: lista de recorridos y video tutorial
// ======================================================================
export const VIDEO_URL = '/tutorial/sano-restaurant-tutorial.mp4';

export function openVideo() {
  const m = openModal({
    title: 'Video tutorial', sub: 'Cómo usar SANO Restaurant, paso a paso', size: 'xl',
    body: `<video class="tutorial-video" src="${VIDEO_URL}" poster="/tutorial/portada.jpg" controls autoplay playsinline preload="metadata"></video>`,
    footer: '<a class="btn btn-secondary" href="' + VIDEO_URL + '" download>' + icon('download') + ' Descargar</a><button class="btn btn-primary" data-close>Cerrar</button>'
  });
  return m;
}

export function openHelp() {
  const m = openModal({
    title: 'Ayuda', sub: 'Elige un recorrido guiado o mira el video tutorial', size: 'md',
    body: `<div class="stack">
      <button type="button" class="help-video" data-video><span class="help-play">${icon('arrowRight')}</span><span><b>Video tutorial</b><small>Las funciones principales explicadas con voz</small></span></button>
      <div class="section-title">Recorridos guiados</div>
      <div class="help-list">${Object.entries(TOURS).map(([k, t]) => `<button type="button" class="help-item" data-tour-id="${k}"><span class="kpi-icon tone-brand" style="width:36px;height:36px">${icon(t.icon)}</span><span class="grow"><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></span>${icon('arrowRight')}</button>`).join('')}</div>
    </div>`,
    footer: '<button class="btn btn-primary" data-close>Cerrar</button>'
  });
  m.el.querySelector('[data-video]').onclick = () => { m.close(); openVideo(); };
  m.el.querySelectorAll('[data-tour-id]').forEach((b) => b.onclick = () => { m.close(); startTour(b.dataset.tourId); });
}
