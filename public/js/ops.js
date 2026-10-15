// SANO Restaurant — Operaciones de negocio (atómicas, funcionan sin conexión)
import { store, convertQty, unitShort, ORDER_TYPES } from './store.js';
import { session } from './auth.js';
import { round2, round4, nowISO, todayKey, dayKey, docNumber, PAY_METHODS, shortId, qtyFmt } from './utils.js';

const by = () => (session.user?.isAnonymous ? 'demo' : session.user?.email || '');
const FLOW0 = () => ({ inUSD: 0, inBs: 0, outUSD: 0, outBs: 0 });

// ======================================================================
// LÍNEAS DEL PEDIDO
// ======================================================================
/** Normaliza una línea del carrito/pedido */
export function cleanLine(l) {
  const p = store.product(l.productId);
  const extras = (l.extras || []).map((e) => ({ id: e.id, name: e.name, price: round2(e.price) }));
  const base = Number(l.basePrice ?? l.price) || 0;
  const unitPrice = round2(base + extras.reduce((a, e) => a + e.price, 0));
  return {
    lineId: l.lineId || shortId(10),
    productId: l.productId || null,
    name: l.name || p?.name || 'Producto',
    category: l.category || p?.category || '',
    emoji: l.emoji || p?.emoji || '',
    variantId: l.variantId || null,
    variantName: l.variantName || '',
    basePrice: round2(base),
    extras,
    qty: Number(l.qty) || 1,
    unitPrice,
    total: round2(unitPrice * (Number(l.qty) || 1)),
    note: (l.note || '').trim(),
    kitchen: l.kitchen ?? (p ? p.kitchen !== false : true),
    sent: !!l.sent,
    addedAt: l.addedAt || nowISO()
  };
}

export function lineLabel(l) {
  return `${l.name}${l.variantName ? ' · ' + l.variantName : ''}`;
}

/** Totales de un pedido */
export function orderTotals(lines, { discount = 0, servicePct = 0, deliveryFee = 0, tip = 0 } = {}) {
  const subtotal = round2(lines.reduce((a, l) => a + (Number(l.total) || 0), 0));
  const disc = Math.min(round2(discount), subtotal);
  const service = round2((subtotal - disc) * (Number(servicePct) || 0) / 100);
  const delivery = round2(deliveryFee);
  const tipV = round2(tip);
  const total = round2(subtotal - disc + service + delivery + tipV);
  return { subtotal, discount: disc, service, delivery, tip: tipV, total };
}

function ticketItems(lines) {
  return lines.map((l) => ({
    name: l.name, variantName: l.variantName || '', qty: l.qty,
    extras: (l.extras || []).map((e) => e.name), note: l.note || '', emoji: l.emoji || ''
  }));
}

function orderLabel(o) {
  if (o.type === 'mesa') return o.tableName || 'Mesa';
  if (o.type === 'delivery') return `Delivery${o.customerName ? ' · ' + o.customerName : ''}`;
  return `Para llevar${o.customerName && o.customerName !== 'Mostrador' ? ' · ' + o.customerName : ''}`;
}

/** Agrega al lote un ticket de cocina con las líneas que aún no se han enviado. Devuelve las líneas marcadas. */
function addKitchenTicket(b, order, lines) {
  const pending = lines.filter((l) => l.kitchen && !l.sent);
  if (!pending.length) return lines;
  const round = (Number(order.rounds) || 0) + 1;
  b.set(store.newRef('tickets'), {
    orderId: order.id || null, orderNo: order.orderNo, type: order.type, label: orderLabel(order),
    waiter: order.waiter || '', note: order.note || '', round, items: ticketItems(pending),
    status: 'pendiente', active: true, createdAt: nowISO(), date: nowISO()
  });
  order.rounds = round;
  return lines.map((l) => (l.kitchen && !l.sent ? { ...l, sent: true, sentAt: nowISO() } : l));
}

// ======================================================================
// PEDIDOS (mesas, para llevar y delivery pendientes de cobro)
// ======================================================================
/**
 * Crea o actualiza un pedido abierto. Si sendToKitchen, envía a cocina las líneas nuevas.
 * Devuelve el pedido guardado.
 */
export async function saveOrder({ orderId = null, type = 'mesa', tableId = null, customer = null, lines = [], note = '', waiter = '', people = 0, deliveryFee = 0, address = '', sendToKitchen = true }) {
  if (!lines.length) throw new Error('El pedido no tiene productos.');
  if (type === 'mesa' && !tableId) throw new Error('Selecciona la mesa.');
  const existing = orderId ? store.order(orderId) : (type === 'mesa' ? store.orderForTable(tableId) : null);
  const b = store.batch();
  const ref = existing ? store.ref('orders', existing.id) : store.newRef('orders');
  const table = tableId ? store.table(tableId) : null;
  let clean = lines.map(cleanLine);
  const order = {
    id: ref.id,
    orderNo: existing?.orderNo || store.nextOrderNo(b),
    type,
    tableId: type === 'mesa' ? tableId : null,
    tableName: type === 'mesa' ? (table?.name || existing?.tableName || 'Mesa') : '',
    customerId: customer?.id || existing?.customerId || null,
    customerName: customer?.name || existing?.customerName || '',
    customerPhone: customer?.phone || existing?.customerPhone || '',
    address: address || customer?.address || existing?.address || '',
    waiter: waiter || existing?.waiter || '',
    people: Number(people) || existing?.people || 0,
    note: note || '',
    deliveryFee: type === 'delivery' ? round2(deliveryFee) : 0,
    rounds: existing?.rounds || 0,
    status: 'open',
    createdAt: existing?.createdAt || nowISO(),
    updatedAt: nowISO(),
    by: existing?.by || by()
  };
  if (sendToKitchen) clean = addKitchenTicket(b, order, clean);
  order.items = clean;
  order.total = orderTotals(clean, { deliveryFee: order.deliveryFee }).total;
  const { id, ...data } = order;
  b.set(ref, data);
  await store.commit(b);
  return order;
}

export async function cancelOrder(order, reason = '') {
  const b = store.batch();
  b.update(store.ref('orders', order.id), { status: 'cancelled', cancelledAt: nowISO(), cancelReason: reason, cancelledBy: by() });
  for (const t of store.tickets.filter((x) => x.orderId === order.id)) {
    b.update(store.ref('tickets', t.id), { active: false, status: 'cancelado', updatedAt: nowISO() });
  }
  await store.commit(b);
}

export async function moveOrder(order, tableId) {
  const t = store.table(tableId);
  if (!t) throw new Error('Mesa no encontrada.');
  if (store.orderForTable(tableId)) throw new Error(`La ${t.name} ya tiene un pedido abierto.`);
  const b = store.batch();
  b.update(store.ref('orders', order.id), { tableId, tableName: t.name, updatedAt: nowISO() });
  for (const k of store.tickets.filter((x) => x.orderId === order.id)) b.update(store.ref('tickets', k.id), { label: t.name });
  await store.commit(b);
}

// ======================================================================
// COCINA
// ======================================================================
export const TICKET_FLOW = ['pendiente', 'preparando', 'listo', 'entregado'];
export async function setTicketStatus(ticket, status) {
  const patch = { status, updatedAt: nowISO() };
  if (status === 'preparando') patch.startedAt = nowISO();
  if (status === 'listo') patch.readyAt = nowISO();
  if (status === 'entregado') { patch.active = false; patch.deliveredAt = nowISO(); }
  await store.save('tickets', ticket.id, patch, true);
}

// ======================================================================
// VENTAS
// ======================================================================
/** Calcula el flujo de efectivo de los pagos y el vuelto */
export function cashFlowOf(payments, changeUSD, changeCurrency, rate) {
  const f = FLOW0();
  for (const p of payments) {
    if (p.method === 'efectivo_usd') f.inUSD += p.amount;
    if (p.method === 'efectivo_bs') f.inBs += p.amount;
  }
  if (changeUSD > 0.004) {
    if (changeCurrency === 'BS') f.outBs += round2(changeUSD * rate);
    else f.outUSD += round2(changeUSD);
  }
  for (const k in f) f[k] = round2(f[k]);
  return f;
}

function shiftIncrements(flow, extra = {}) {
  const u = {};
  for (const k of ['inUSD', 'inBs', 'outUSD', 'outBs']) if (flow[k]) u[k] = store.inc(flow[k]);
  for (const [k, v] of Object.entries(extra)) if (v) u[k] = store.inc(round4(v));
  u.updatedAt = nowISO();
  return u;
}

/**
 * Cobra una venta (rápida o de un pedido abierto). Descuenta los insumos según las recetas.
 * payments: [{method, amount}] (amount en la moneda del método)
 */
export async function chargeSale({ order = null, type = 'llevar', tableId = null, lines, customer = null, discount = 0, servicePct = 0, deliveryFee = 0, tip = 0, payments = [], changeCurrency = 'BS', note = '', waiter = '', people = 0, address = '' }) {
  const rate = store.rate;
  if (!(rate > 0)) throw new Error('Configura la tasa del día antes de cobrar.');
  const shift = store.openShift;
  if (!shift) throw new Error('Abre la caja antes de cobrar.');
  let clean = (lines || []).map(cleanLine);
  if (!clean.length) throw new Error('El pedido está vacío.');

  if (!store.settings.allowNoStock) {
    const miss = store.shortages(clean);
    if (miss.length) {
      const e = new Error('Stock insuficiente: ' + miss.map((m) => `${m.ing.name} (faltan ${qtyFmt(round2(m.need - m.have))} ${unitShort(m.ing.unit)})`).join(', '));
      e.shortages = miss; throw e;
    }
  }

  const t = orderTotals(clean, { discount, servicePct, deliveryFee: type === 'delivery' ? deliveryFee : 0, tip });
  const pays = payments.filter((p) => p.amount > 0.004).map((p) => {
    const cur = PAY_METHODS[p.method]?.cur || 'USD';
    return { method: p.method, currency: cur, amount: round2(p.amount), usd: round4(cur === 'BS' ? p.amount / rate : p.amount) };
  });
  const paidUSD = round4(pays.reduce((a, p) => a + p.usd, 0));
  if (paidUSD < t.total - 0.01) throw new Error(`Falta por cobrar $${round2(t.total - paidUSD).toFixed(2)}.`);
  const changeUSD = round2(Math.max(0, paidUSD - t.total));
  const flow = cashFlowOf(pays, changeUSD, changeCurrency, rate);

  const b = store.batch();
  const date = nowISO();
  const table = tableId ? store.table(tableId) : null;
  const o = {
    id: order?.id || null,
    orderNo: order?.orderNo || store.nextOrderNo(b),
    type,
    tableName: type === 'mesa' ? (order?.tableName || table?.name || 'Mesa') : '',
    customerName: customer?.name || order?.customerName || '',
    waiter: waiter || order?.waiter || '',
    note: note || order?.note || '',
    rounds: order?.rounds || 0
  };
  clean = addKitchenTicket(b, o, clean);

  // Consumo de insumos según las recetas
  const consumption = [];
  const lowAfter = [];
  for (const [ingId, qty] of store.consumptionOf(clean)) {
    const ing = store.ingredient(ingId);
    if (!ing) continue;
    const q = round4(qty);
    consumption.push({ ingredientId: ingId, name: ing.name, unit: ing.unit, qty: q, cost: round4((Number(ing.cost) || 0) * q) });
    b.update(store.ref('ingredients', ingId), { stock: store.inc(-q), updatedAt: date });
    const left = (Number(ing.stock) || 0) - q;
    if (left <= (Number(ing.minStock) || 0)) lowAfter.push({ ...ing, stock: left });
  }
  const cost = round2(consumption.reduce((a, c) => a + c.cost, 0));

  const saleRef = store.newRef('sales');
  const sale = {
    number: docNumber('V'),
    orderNo: o.orderNo,
    orderId: order?.id || null,
    type, typeLabel: ORDER_TYPES[type]?.label || type,
    tableName: o.tableName,
    date, dayKey: todayKey(),
    items: clean.map(({ sent, sentAt, addedAt, ...l }) => l),
    ...t,
    servicePct: Number(servicePct) || 0,
    cost,
    rate, totalBs: round2(t.total * rate),
    payments: pays, paidUSD, changeUSD, changeCurrency,
    method: pays.length === 1 ? pays[0].method : 'mixto',
    customerId: customer?.id || order?.customerId || null,
    customerName: customer?.name || order?.customerName || 'Mostrador',
    customerPhone: customer?.phone || order?.customerPhone || '',
    address: address || order?.address || '',
    waiter: o.waiter, people: Number(people) || order?.people || 0,
    note: o.note,
    consumption,
    shiftId: shift.id,
    cashFlow: flow,
    status: 'completed',
    by: by()
  };
  b.set(saleRef, sale);

  if (order?.id) {
    b.update(store.ref('orders', order.id), { status: 'paid', paidAt: date, saleId: saleRef.id, saleNumber: sale.number, items: clean, total: t.total, updatedAt: date });
  }

  // Caja
  const byMethod = {};
  pays.forEach((p) => { byMethod[`byMethod.${p.method}`] = (byMethod[`byMethod.${p.method}`] || 0) + p.usd; });
  b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { salesCount: 1, salesTotal: t.total, tipsTotal: t.tip, serviceTotal: t.service, ...byMethod }));

  // Cliente
  const custId = customer?.id || order?.customerId;
  if (custId && store.customer(custId)) {
    b.update(store.ref('customers', custId), { visits: store.inc(1), totalSpent: store.inc(t.total), lastVisitAt: date });
  }

  await store.commit(b);
  return { sale: { id: saleRef.id, ...sale }, lowAfter };
}

/** Anula una venta: devuelve los insumos al inventario y revierte la caja (en el turno abierto) */
export async function voidSale(sale, reason = '') {
  if (sale.status === 'voided') throw new Error('La venta ya está anulada.');
  const b = store.batch();
  const date = nowISO();
  b.update(store.ref('sales', sale.id), { status: 'voided', voidedAt: date, voidReason: reason || '', voidedBy: by() });
  for (const c of sale.consumption || []) {
    if (!store.ingredient(c.ingredientId)) continue;
    b.update(store.ref('ingredients', c.ingredientId), { stock: store.inc(c.qty), updatedAt: date });
  }
  const shift = store.openShift;
  const f = sale.cashFlow || FLOW0();
  const reverse = { inUSD: f.outUSD || 0, inBs: f.outBs || 0, outUSD: f.inUSD || 0, outBs: f.inBs || 0 };
  let cashReverted = false;
  if (shift) {
    const extra = {};
    if (sale.shiftId === shift.id) {
      extra.salesCount = -1; extra.salesTotal = -(sale.total || 0); extra.tipsTotal = -(sale.tip || 0); extra.serviceTotal = -(sale.service || 0);
      (sale.payments || []).forEach((p) => { extra[`byMethod.${p.method}`] = (extra[`byMethod.${p.method}`] || 0) - p.usd; });
    }
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(reverse, extra));
    if (reverse.inUSD || reverse.inBs || reverse.outUSD || reverse.outBs) {
      b.set(store.newRef('cash_movements'), {
        shiftId: shift.id, date, dayKey: todayKey(), type: 'void', direction: 'out', currency: 'USD', amount: 0,
        flow: reverse, concept: `Anulación ${sale.number}`, category: 'Anulaciones', refId: sale.id, by: by()
      });
    }
    cashReverted = true;
  }
  await store.commit(b);
  return { cashReverted };
}

// ======================================================================
// CAJA
// ======================================================================
export async function cashMovement({ direction, currency, amount, concept, category, note = '' }) {
  const shift = store.openShift;
  if (!shift) throw new Error('No hay caja abierta.');
  const b = store.batch();
  const flow = FLOW0();
  flow[(direction === 'in' ? 'in' : 'out') + (currency === 'BS' ? 'Bs' : 'USD')] = round2(amount);
  const date = nowISO();
  b.set(store.newRef('cash_movements'), {
    shiftId: shift.id, date, dayKey: todayKey(), type: direction === 'in' ? 'income' : 'expense', direction, currency,
    amount: round2(amount), rate: store.rate, flow, concept, category, note, by: by()
  });
  const usdV = currency === 'BS' ? amount / store.rate : amount;
  b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, direction === 'out' ? { expensesUSD: usdV } : { incomeUSD: usdV }));
  await store.commit(b);
}

export async function openShift({ openingUSD, openingBs, note = '' }) {
  if (store.openShift) throw new Error('Ya hay una caja abierta.');
  const ref = store.newRef('cash_shifts');
  const b = store.batch();
  b.set(ref, {
    status: 'open', openedAt: nowISO(), openedBy: by(), dayKey: todayKey(), number: docNumber('T'),
    openingUSD: round2(openingUSD), openingBs: round2(openingBs), rateAtOpen: store.rate,
    inUSD: 0, inBs: 0, outUSD: 0, outBs: 0, salesCount: 0, salesTotal: 0, note
  });
  await store.commit(b);
  return ref.id;
}

export function shiftExpected(shift) {
  return {
    usd: round2((shift.openingUSD || 0) + (shift.inUSD || 0) - (shift.outUSD || 0)),
    bs: round2((shift.openingBs || 0) + (shift.inBs || 0) - (shift.outBs || 0))
  };
}

export async function closeShift(shift, { countedUSD, countedBs, note = '' }) {
  const exp = shiftExpected(shift);
  const b = store.batch();
  b.update(store.ref('cash_shifts', shift.id), {
    status: 'closed', closedAt: nowISO(), closedBy: by(), rateAtClose: store.rate,
    expectedUSD: exp.usd, expectedBs: exp.bs, countedUSD: round2(countedUSD), countedBs: round2(countedBs),
    diffUSD: round2(countedUSD - exp.usd), diffBs: round2(countedBs - exp.bs), closeNote: note
  });
  await store.commit(b);
}

// ======================================================================
// INVENTARIO DE INSUMOS
// ======================================================================
/**
 * Movimiento de un insumo.
 * mode: 'compra' (entrada con costo) | 'entrada' | 'merma' | 'salida' | 'conteo' (fija el stock)
 * qty se expresa en `unit` (se convierte a la unidad del insumo).
 */
export async function moveIngredient(ing, { mode, qty, unit, reason = '', totalCost = 0, payFromCash = false, payCurrency = 'USD' }) {
  const current = Number(store.ingredient(ing.id)?.stock ?? ing.stock) || 0;
  const q = round4(convertQty(Number(qty) || 0, unit || ing.unit, ing.unit));
  let delta = mode === 'compra' || mode === 'entrada' ? q : mode === 'conteo' ? q - current : -q;
  delta = round4(delta);
  const date = nowISO();
  const b = store.batch();
  const patch = { stock: store.inc(delta), updatedAt: date };
  if (mode === 'compra' && totalCost > 0 && q > 0) {
    // Costo promedio ponderado: mantiene el costo de recetas realista
    const oldVal = Math.max(0, current) * (Number(ing.cost) || 0);
    patch.cost = round4((oldVal + Number(totalCost)) / (Math.max(0, current) + q));
    patch.lastCost = round4(totalCost / q);
    patch.lastPurchaseAt = date;
  }
  b.update(store.ref('ingredients', ing.id), patch);
  b.set(store.newRef('inventory_logs'), {
    ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit, date, dayKey: dayKey(), type: mode,
    qty: delta, before: round4(current), after: round4(current + delta), totalCost: round2(totalCost), reason, by: by()
  });
  if (mode === 'compra' && payFromCash && totalCost > 0) {
    const shift = store.openShift;
    if (!shift) throw new Error('Para pagar la compra con la caja, ábrela primero.');
    const amount = payCurrency === 'BS' ? round2(totalCost * store.rate) : round2(totalCost);
    const flow = FLOW0();
    flow[payCurrency === 'BS' ? 'outBs' : 'outUSD'] = amount;
    b.set(store.newRef('cash_movements'), {
      shiftId: shift.id, date, dayKey: todayKey(), type: 'expense', direction: 'out', currency: payCurrency, amount,
      rate: store.rate, flow, concept: `Compra: ${ing.name} (${qtyFmt(q)} ${unitShort(ing.unit)})`, category: 'Compras de insumos', by: by()
    });
    b.update(store.ref('cash_shifts', shift.id), shiftIncrements(flow, { expensesUSD: totalCost }));
  }
  await store.commit(b);
  return delta;
}
