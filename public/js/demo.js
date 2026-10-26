// SANO Restaurant — Modo demo (sesión anónima de 30 minutos) y menú de ejemplo
import { auth, db, doc, collection, writeBatch, getDoc, getDocs, Timestamp, signInAnonymously, signOut } from './firebase.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { chargeSale, saveOrder, setTicketStatus, cleanLine } from './ops.js';
import { fetchBcvRate } from './shared.js';
import { round2, nowISO, todayKey, dayKey, addDays, docNumber, shortId, sha256 } from './utils.js';

/** PIN de administrador de todas las demos (se muestra en pantalla) */
export const DEMO_PIN = '1234';

export const DEMO_MINUTES = 30;
const DATA_COLLECTIONS = ['ingredients', 'products', 'tables', 'orders', 'tickets', 'customers', 'cash_shifts', 'cash_movements', 'sales', 'inventory_logs', 'config'];

export async function startDemo() { await signInAnonymously(auth); }

export function demoRemainingMs(tenant) {
  const exp = tenant?.expiresAt;
  if (!exp) return 0;
  const ms = typeof exp.toMillis === 'function' ? exp.toMillis() : new Date(exp).getTime();
  return ms - Date.now();
}

// [clave, nombre, unidad, categoría, stock, mínimo, costo por unidad]
const INGREDIENTS = [
  ['panPerro', 'Pan de perro', 'und', 'Panes y masas', 60, 15, 0.15],
  ['panHamb', 'Pan de hamburguesa', 'und', 'Panes y masas', 36, 10, 0.25],
  ['masa', 'Masa de pizza', 'g', 'Panes y masas', 6000, 1200, 0.002],
  ['salchicha', 'Salchicha', 'und', 'Carnes y embutidos', 48, 15, 0.30],
  ['carne', 'Carne de hamburguesa 120 g', 'und', 'Carnes y embutidos', 30, 10, 0.90],
  ['tocineta', 'Tocineta', 'g', 'Carnes y embutidos', 900, 250, 0.018],
  ['pepperoni', 'Pepperoni', 'g', 'Carnes y embutidos', 1200, 300, 0.015],
  ['jamon', 'Jamón', 'g', 'Carnes y embutidos', 1500, 400, 0.009],
  ['queso', 'Queso amarillo', 'reb', 'Quesos y lácteos', 70, 20, 0.12],
  ['mozzarella', 'Queso mozzarella', 'g', 'Quesos y lácteos', 3500, 800, 0.008],
  ['huevo', 'Huevo', 'und', 'Quesos y lácteos', 30, 12, 0.15],
  ['repollo', 'Ensalada de repollo', 'g', 'Vegetales', 1800, 500, 0.002],
  ['papas', 'Papas fritas congeladas', 'g', 'Vegetales', 7000, 2000, 0.003],
  ['papitas', 'Papitas rayadas', 'g', 'Otros', 280, 300, 0.006],
  ['salsas', 'Salsas de la casa', 'ml', 'Salsas', 4000, 800, 0.002],
  ['salsaPizza', 'Salsa para pizza', 'ml', 'Salsas', 2500, 600, 0.003],
  ['lata', 'Refresco lata 355 ml', 'und', 'Bebidas', 40, 12, 0.55],
  ['refresco15', 'Refresco 1,5 L', 'und', 'Bebidas', 10, 4, 1.40],
  ['agua', 'Agua mineral 600 ml', 'und', 'Bebidas', 24, 6, 0.35],
  ['envase', 'Envase para llevar', 'und', 'Empaques', 90, 30, 0.12]
];

const R = (...pairs) => pairs.map(([k, qty]) => ({ k, qty }));
const X = (name, price, k, qty) => ({ name, price, recipe: k ? R([k, qty]) : [] });
// Productos del menú de ejemplo
const PRODUCTS = [
  { name: 'Perro caliente sencillo', category: 'Perros calientes', emoji: '🌭', color: '#fde4cf', price: 1.5, description: 'Salchicha, repollo, papitas y salsas', recipe: R(['panPerro', 1], ['salchicha', 1], ['repollo', 20], ['papitas', 10], ['salsas', 20]), extras: [X('Extra queso', 0.5, 'queso', 1), X('Extra tocineta', 0.8, 'tocineta', 15)] },
  { name: 'Perro especial', category: 'Perros calientes', emoji: '🌭', color: '#ffd6a5', price: 2.5, description: 'Con queso, tocineta, papitas y salsas', recipe: R(['panPerro', 1], ['salchicha', 1], ['queso', 2], ['tocineta', 15], ['repollo', 20], ['papitas', 15], ['salsas', 25]), extras: [X('Extra queso', 0.5, 'queso', 1), X('Salchicha extra', 0.8, 'salchicha', 1), X('Huevo', 0.5, 'huevo', 1)] },
  { name: 'Hamburguesa clásica', category: 'Hamburguesas', emoji: '🍔', color: '#ffd6a5', price: 4, description: 'Carne 120 g, queso, ensalada y salsas', recipe: R(['panHamb', 1], ['carne', 1], ['queso', 1], ['repollo', 25], ['salsas', 25]), extras: [X('Extra queso', 0.5, 'queso', 1), X('Tocineta', 1, 'tocineta', 20), X('Huevo', 0.5, 'huevo', 1), X('Carne extra', 2, 'carne', 1)] },
  { name: 'Hamburguesa doble con tocineta', category: 'Hamburguesas', emoji: '🍔', color: '#fdffb6', price: 6.5, description: 'Doble carne, doble queso y tocineta', recipe: R(['panHamb', 1], ['carne', 2], ['queso', 2], ['tocineta', 25], ['repollo', 25], ['salsas', 30]), extras: [X('Huevo', 0.5, 'huevo', 1)] },
  { name: 'Pizza margarita', category: 'Pizzas', emoji: '🍕', color: '#ffadad', description: 'Salsa de tomate y mozzarella', variants: [
    { name: 'Personal', price: 5, recipe: R(['masa', 180], ['salsaPizza', 60], ['mozzarella', 120]) },
    { name: 'Mediana', price: 8, recipe: R(['masa', 300], ['salsaPizza', 100], ['mozzarella', 200]) },
    { name: 'Familiar', price: 12, recipe: R(['masa', 450], ['salsaPizza', 150], ['mozzarella', 320]) }], extras: [X('Extra queso', 1.5, 'mozzarella', 80), X('Jamón', 1.5, 'jamon', 60)] },
  { name: 'Pizza pepperoni', category: 'Pizzas', emoji: '🍕', color: '#ffc6ff', description: 'Mozzarella y pepperoni', variants: [
    { name: 'Personal', price: 6, recipe: R(['masa', 180], ['salsaPizza', 60], ['mozzarella', 120], ['pepperoni', 40]) },
    { name: 'Mediana', price: 10, recipe: R(['masa', 300], ['salsaPizza', 100], ['mozzarella', 200], ['pepperoni', 70]) },
    { name: 'Familiar', price: 14, recipe: R(['masa', 450], ['salsaPizza', 150], ['mozzarella', 320], ['pepperoni', 100]) }], extras: [X('Extra queso', 1.5, 'mozzarella', 80)] },
  { name: 'Papas fritas', category: 'Acompañantes', emoji: '🍟', color: '#fdffb6', description: 'Crujientes, con salsas', variants: [
    { name: 'Pequeñas', price: 1.5, recipe: R(['papas', 150], ['salsas', 15]) },
    { name: 'Grandes', price: 2.5, recipe: R(['papas', 250], ['salsas', 25]) }], extras: [X('Con queso y tocineta', 1.5, 'tocineta', 15)] },
  { name: 'Combo perro + refresco', category: 'Combos', emoji: '🥤', color: '#caffbf', price: 3.2, description: 'Perro especial y refresco en lata', recipe: R(['panPerro', 1], ['salchicha', 1], ['queso', 2], ['papitas', 15], ['salsas', 25], ['lata', 1], ['envase', 1]) },
  { name: 'Combo hamburguesa', category: 'Combos', emoji: '🍔', color: '#caffbf', price: 6, description: 'Hamburguesa clásica, papas y refresco', recipe: R(['panHamb', 1], ['carne', 1], ['queso', 1], ['repollo', 25], ['salsas', 40], ['papas', 150], ['lata', 1], ['envase', 1]) },
  { name: 'Refresco lata', category: 'Bebidas', emoji: '🥤', color: '#9bf6ff', price: 1, kind: 'reventa', kitchen: false, recipe: R(['lata', 1]) },
  { name: 'Refresco 1,5 L', category: 'Bebidas', emoji: '🧃', color: '#a0c4ff', price: 2.5, kind: 'reventa', kitchen: false, recipe: R(['refresco15', 1]) },
  { name: 'Agua mineral', category: 'Bebidas', emoji: '💧', color: '#9bf6ff', price: 0.8, kind: 'reventa', kitchen: false, recipe: R(['agua', 1]) }
];

/** Crea los insumos y productos de ejemplo en la sede actual. Devuelve el mapa clave→id de insumos. */
export async function seedSampleMenu({ stock = true } = {}) {
  const b = store.batch();
  const ids = {};
  const now = nowISO();
  for (const [k, name, unit, category, st, min, cost] of INGREDIENTS) {
    const ref = store.newRef('ingredients'); ids[k] = ref.id;
    b.set(ref, { name, unit, category, stock: stock ? st : 0, minStock: min, cost, supplier: '', active: true, createdAt: now, updatedAt: now });
  }
  const map = (rec) => (rec || []).map((r) => ({ ingredientId: ids[r.k], qty: r.qty }));
  PRODUCTS.forEach((p, i) => {
    b.set(store.newRef('products'), {
      name: p.name, category: p.category, emoji: p.emoji, color: p.color || '', description: p.description || '', image: null,
      kind: p.kind || 'receta', kitchen: p.kitchen !== false, available: true, sort: i,
      price: p.price ?? Math.min(...p.variants.map((v) => v.price)),
      recipe: map(p.recipe),
      variants: (p.variants || []).map((v) => ({ id: shortId(6), name: v.name, price: v.price, recipe: map(v.recipe) })),
      extras: (p.extras || []).map((x) => ({ id: shortId(6), name: x.name, price: x.price, recipe: map(x.recipe) })),
      createdAt: now, updatedAt: now
    });
  });
  const cats = [...new Set([...PRODUCTS.map((p) => p.category), ...store.settings.categories])];
  b.set(store.ref('config', 'settings'), { categories: cats }, { merge: true });
  await store.commit(b);
  return ids;
}

/** Crea la sede de demostración con configuración, mesas, clientes y caja abierta. */
export async function createDemoTenant(uid) {
  const now = Date.now();
  const expiresAt = Timestamp.fromMillis(now + DEMO_MINUTES * 60 * 1000);
  let rate = 0;
  try { rate = (await Promise.race([fetchBcvRate(), new Promise((_, r) => setTimeout(() => r(new Error('t')), 3500))])).rate; } catch (_) { rate = 0; }
  if (!(rate > 0)) rate = 40;
  rate = round2(rate);

  const b1 = writeBatch(db);
  b1.set(doc(db, 'tenants', uid), { name: 'Perros & Burgers Demo', code: 'demo', ownerUid: uid, ownerEmail: '', active: true, demo: true, createdAt: nowISO(), expiresAt });
  await b1.commit();

  const ref = (name, id) => doc(db, 'tenants', uid, name, id || doc(collection(db, 'tenants', uid, name)).id);
  const b = writeBatch(db);
  b.set(ref('config', 'settings'), {
    ...DEFAULT_SETTINGS, businessName: 'Perros & Burgers Demo', rif: 'J-00000000-0', phone: '0414-0000000', address: 'Av. Principal, Local 1', instagram: '@sanorestaurant',
    receiptFooter: '¡Gracias por probar SANO Restaurant!', rate, rateUpdatedAt: nowISO(), rateSource: 'bcv', deliveryFee: 1.5, staff: ['Carlos', 'María', 'José']
  });
  b.set(ref('config', 'security'), { pinHash: await sha256(`${uid}:${DEMO_PIN}`), updatedAt: nowISO() });
  const tables = [['Mesa 1', 'Salón'], ['Mesa 2', 'Salón'], ['Mesa 3', 'Salón'], ['Mesa 4', 'Salón'], ['Mesa 5', 'Salón'], ['Mesa 6', 'Salón'], ['Terraza 1', 'Terraza'], ['Terraza 2', 'Terraza'], ['Terraza 3', 'Terraza']];
  tables.forEach(([name, zone]) => b.set(ref('tables'), { name, zone, seats: 4, createdAt: nowISO() }));
  for (const [name, phone, address] of [['María González', '0414-1234567', 'Urb. El Centro, calle 3, casa 12'], ['José Rodríguez', '0424-7654321', 'Res. Los Pinos, torre B, apto 4-2'], ['Carmen Pérez', '0412-5551234', 'Sector La Esperanza, frente a la plaza']]) {
    b.set(ref('customers'), { name, phone, idDoc: '', address, notes: '', visits: 0, totalSpent: 0, createdAt: nowISO() });
  }
  b.set(ref('cash_shifts'), {
    status: 'open', openedAt: nowISO(), openedBy: 'demo', dayKey: todayKey(), number: 'T-DEMO',
    openingUSD: 20, openingBs: round2(rate * 10), rateAtOpen: rate, inUSD: 0, inBs: 0, outUSD: 0, outBs: 0, salesCount: 0, salesTotal: 0, note: 'Turno de demostración'
  });
  await b.commit();
}

/** Menú, ventas de la semana, pedidos en cocina y una mesa ocupada para que la demo se vea con vida. */
export async function seedDemoActivity() {
  await seedSampleMenu({ stock: true });
  await new Promise((r) => setTimeout(r, 400));
  const P = (n) => store.products.find((x) => x.name === n);
  const line = (n, qty = 1, variant = null, extras = []) => {
    const p = P(n); if (!p) return null;
    const v = variant ? p.variants.find((x) => x.name === variant) : null;
    return cleanLine({ productId: p.id, name: p.name, emoji: p.emoji, kitchen: p.kitchen !== false, variantId: v?.id || null, variantName: v?.name || '', basePrice: v ? v.price : p.price, qty, extras: extras.map((e) => p.extras.find((x) => x.name === e)).filter(Boolean) });
  };
  const rate = store.rate;

  // Ventas anteriores (solo historial, para los gráficos)
  const b = store.batch();
  const pastMenu = [['Perro especial', null, 2.5], ['Hamburguesa clásica', null, 4], ['Pizza pepperoni', 'Mediana', 10], ['Combo perro + refresco', null, 3.2], ['Papas fritas', 'Grandes', 2.5], ['Refresco lata', null, 1], ['Combo hamburguesa', null, 6]];
  const methods = ['efectivo_usd', 'pagomovil', 'punto', 'efectivo_bs', 'zelle'];
  for (let d = 6; d >= 1; d--) {
    const n = 6 + ((d * 7) % 9);
    for (let i = 0; i < n; i++) {
      const date = addDays(new Date(), -d); date.setHours(11 + (i % 10), (i * 13) % 60, 0, 0);
      const picks = [pastMenu[(i + d) % pastMenu.length], pastMenu[(i * 3 + d) % pastMenu.length]].slice(0, 1 + (i % 2));
      const items = picks.map(([name, variant, price]) => ({ productId: P(name)?.id || null, name, variantName: variant || '', variantId: null, qty: 1 + (i % 3 === 0 ? 1 : 0), unitPrice: price, basePrice: price, total: price * (1 + (i % 3 === 0 ? 1 : 0)), extras: [], category: P(name)?.category || '', emoji: P(name)?.emoji || '' }));
      const total = round2(items.reduce((a, x) => a + x.total, 0));
      const m = methods[(i + d) % methods.length];
      const cur = m === 'efectivo_usd' || m === 'zelle' ? 'USD' : 'BS';
      const type = ['llevar', 'mesa', 'delivery', 'llevar'][i % 4];
      b.set(store.newRef('sales'), {
        number: docNumber('V'), orderNo: i + 1, type, typeLabel: { llevar: 'Para llevar', mesa: 'Mesa', delivery: 'Delivery' }[type], tableName: type === 'mesa' ? `Mesa ${1 + (i % 6)}` : '',
        date: date.toISOString(), dayKey: dayKey(date), items, subtotal: total, discount: 0, delivery: 0, tip: 0, total, cost: round2(total * 0.36),
        rate, totalBs: round2(total * rate), payments: [{ method: m, currency: cur, amount: cur === 'BS' ? round2(total * rate) : total, usd: total }], paidUSD: total, changeUSD: 0, changeCurrency: 'BS', method: m,
        customerId: null, customerName: 'Mostrador', consumption: [], status: 'completed', shiftId: 'historial', by: 'demo'
      });
    }
  }
  await store.commit(b);

  // Ventas de hoy (descuentan inventario de verdad)
  const today = [
    { type: 'llevar', lines: [line('Perro especial', 2, null, ['Extra queso']), line('Refresco lata', 2)], pays: [{ method: 'efectivo_usd', amount: 10 }] },
    { type: 'llevar', lines: [line('Combo hamburguesa'), line('Papas fritas', 1, 'Pequeñas')], pays: [{ method: 'pagomovil', amount: round2(7.5 * rate) }] },
    { type: 'delivery', lines: [line('Pizza pepperoni', 1, 'Familiar'), line('Refresco 1,5 L')], pays: [{ method: 'punto', amount: round2(18 * rate) }], customer: store.customers.find((c) => c.name === 'María González'), deliveryFee: 1.5 },
    { type: 'llevar', lines: [line('Hamburguesa doble con tocineta'), line('Agua mineral')], pays: [{ method: 'zelle', amount: 7.3 }] }
  ];
  for (const s of today) {
    try { await chargeSale({ type: s.type, lines: s.lines.filter(Boolean), customer: s.customer || null, deliveryFee: s.deliveryFee || 0, payments: s.pays, changeCurrency: 'BS', note: '' }); } catch (e) { console.warn('[demo] venta', e); }
  }
  // Una mesa ocupada con su comanda en cocina
  const mesa2 = store.tables.find((t) => t.name === 'Mesa 2');
  if (mesa2) { try { await saveOrder({ type: 'mesa', tableId: mesa2.id, lines: [line('Pizza margarita', 1, 'Mediana'), line('Perro caliente sencillo', 2), line('Refresco lata', 3)].filter(Boolean), waiter: 'Carlos', people: 3, sendToKitchen: true }); } catch (e) { console.warn('[demo] mesa', e); } }
  await new Promise((r) => setTimeout(r, 300));
  // Avanza algunas comandas para mostrar el flujo de cocina
  const tk = [...store.tickets];
  if (tk[0]) await setTicketStatus(tk[0], 'entregado').catch(() => {});
  if (tk[1]) await setTicketStatus(tk[1], 'listo').catch(() => {});
  if (tk[2]) await setTicketStatus(tk[2], 'preparando').catch(() => {});
}

/** Borra todos los datos de una sede. Con onlyDemo, también borra el documento si es una demo. */
export async function purgeTenant(tenantId, onlyDemo = true) {
  for (const c of DATA_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, 'tenants', tenantId, c));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const b = writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    } catch (e) { console.warn('[purge]', c, e?.code || e); }
  }
  if (onlyDemo) {
    try {
      const t = await getDoc(doc(db, 'tenants', tenantId));
      if (t.exists() && t.data().demo === true) { const b = writeBatch(db); b.delete(t.ref); await b.commit(); }
    } catch (e) { console.warn('[purge] sede', e?.code || e); }
  }
}

/** Borra la demo actual y la cuenta anónima. */
export async function cleanupDemo(tenantId) {
  await purgeTenant(tenantId, true);
  const u = auth.currentUser;
  if (u && u.isAnonymous) {
    try { await u.delete(); } catch (_) { await signOut(auth).catch(() => {}); }
  }
}
