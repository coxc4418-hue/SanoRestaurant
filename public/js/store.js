// SANO Restaurant — Capa de datos multisede (Firestore en tiempo real + caché offline)
import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot, query, where, writeBatch, increment
} from './firebase.js';
import { addDays, startOfDay, sha256, toast, round4, todayKey } from './utils.js';

// Categorías del menú (lo que se vende)
export const DEFAULT_MENU_CATEGORIES = ['Perros calientes', 'Hamburguesas', 'Pizzas', 'Combos', 'Arepas', 'Pepitos', 'Acompañantes', 'Bebidas', 'Postres'];
// Categorías de insumos (lo que se compra)
export const INGREDIENT_CATEGORIES = ['Panes y masas', 'Carnes y embutidos', 'Quesos y lácteos', 'Vegetales', 'Salsas', 'Bebidas', 'Empaques', 'Otros'];
export const DEFAULT_ZONES = ['Salón', 'Terraza'];

// Unidades de los insumos. Las de la misma familia se convierten entre sí (compras en kg, recetas en g).
export const UNITS = {
  und: { label: 'Unidad', short: 'und', fam: 'und', f: 1 },
  g: { label: 'Gramo', short: 'g', fam: 'mass', f: 1 },
  kg: { label: 'Kilogramo', short: 'kg', fam: 'mass', f: 1000 },
  ml: { label: 'Mililitro', short: 'ml', fam: 'vol', f: 1 },
  l: { label: 'Litro', short: 'L', fam: 'vol', f: 1000 },
  reb: { label: 'Rebanada', short: 'reb', fam: 'reb', f: 1 },
  porc: { label: 'Porción', short: 'porc', fam: 'porc', f: 1 },
  paq: { label: 'Paquete', short: 'paq', fam: 'paq', f: 1 }
};
export const unitShort = (u) => UNITS[u]?.short || u || '';
export const compatibleUnits = (u) => Object.keys(UNITS).filter((k) => UNITS[k].fam === (UNITS[u]?.fam || u));
/** Convierte una cantidad de la unidad `from` a la unidad `to` (misma familia) */
export const convertQty = (qty, from, to) => (UNITS[from] && UNITS[to] && UNITS[from].fam === UNITS[to].fam) ? qty * UNITS[from].f / UNITS[to].f : qty;

export const ORDER_TYPES = {
  llevar: { label: 'Para llevar', icon: 'bag' },
  mesa: { label: 'Mesa', icon: 'table' },
  delivery: { label: 'Delivery', icon: 'truck' }
};

const DEFAULT_SETTINGS = {
  businessName: '',
  rif: '',
  phone: '',
  address: '',
  instagram: '',
  receiptFooter: '¡Gracias por tu compra! Vuelve pronto.',
  receiptFormat: '80mm',
  rate: 0,
  rateUpdatedAt: null,
  rateAuto: true,
  iva: 0,
  serviceCharge: 0,
  deliveryFee: 1,
  allowNoStock: false,
  printKitchen: false,
  categories: DEFAULT_MENU_CATEGORIES,
  ingredientCategories: INGREDIENT_CATEGORIES,
  zones: DEFAULT_ZONES,
  staff: []
};

class Store {
  constructor() {
    this.tenantId = null;
    this.tenant = null;
    this.settings = { ...DEFAULT_SETTINGS };
    this.security = {};
    this.counters = {};
    this.announcement = null;
    this.ingredients = [];
    this.products = [];
    this.tables = [];
    this.orders = [];
    this.tickets = [];
    this.customers = [];
    this.openShift = null;
    this.recentSales = [];
    this.ready = false;
    this._unsubs = [];
    this._listeners = {};
    this._loaded = new Set();
  }

  // ---------- Eventos ----------
  on(evt, fn) { (this._listeners[evt] ||= new Set()).add(fn); return () => this._listeners[evt].delete(fn); }
  emit(evt, data) {
    (this._listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });
    (this._listeners['*'] || []).forEach((fn) => { try { fn(evt); } catch (e) { console.error(e); } });
  }

  // ---------- Referencias ----------
  col(name) { return collection(db, 'tenants', this.tenantId, name); }
  ref(name, id) { return doc(db, 'tenants', this.tenantId, name, String(id)); }
  newRef(name) { return doc(this.col(name)); }
  tenantRef(id = this.tenantId) { return doc(db, 'tenants', id); }
  batch() { return writeBatch(db); }
  get isDemo() { return this.tenant?.demo === true; }
  inc(n) { return increment(n); }

  /**
   * Confirma un lote. La caché local aplica el cambio al instante (también sin internet);
   * se espera la confirmación del servidor como máximo unos segundos para no bloquear la caja.
   */
  async commit(batch) {
    const p = batch.commit();
    p.catch((err) => {
      console.error('[store] commit', err);
      toast(err?.code === 'permission-denied' ? 'Sin permiso para guardar. Verifica que la sede esté activa.' : 'No se pudo sincronizar un cambio: ' + (err?.message || err), 'danger', 5000);
    });
    if (!navigator.onLine) return;
    await Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 3500))]);
  }

  async save(name, id, data, merge = true) {
    const b = this.batch();
    b.set(this.ref(name, id), data, { merge });
    await this.commit(b);
  }
  async remove(name, id) {
    const b = this.batch();
    b.delete(this.ref(name, id));
    await this.commit(b);
  }

  // ---------- Ciclo de vida ----------
  async start(tenantId) {
    this.stop();
    this.tenantId = tenantId;
    this._loaded = new Set();
    const need = ['tenant', 'settings', 'ingredients', 'products', 'tables', 'orders', 'tickets', 'customers', 'shift', 'sales'];
    let resolveReady;
    const readyP = new Promise((r) => { resolveReady = r; });
    const mark = (k) => { this._loaded.add(k); if (need.every((x) => this._loaded.has(x))) resolveReady(); };
    const fail = (k) => (err) => { console.error('[store]', k, err); mark(k); if (err?.code === 'permission-denied') this.emit('denied', err); };
    const listen = (q, k, fn) => this._unsubs.push(onSnapshot(q, (s) => { fn(s); mark(k); this.emit(k); this.emit('change', k); }, fail(k)));
    const rows = (s) => s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'es', { numeric: true });

    listen(this.tenantRef(), 'tenant', (s) => { this.tenant = s.exists() ? { id: s.id, ...s.data() } : null; });
    listen(this.ref('config', 'settings'), 'settings', (s) => {
      this.settings = { ...DEFAULT_SETTINGS, ...(s.exists() ? s.data() : {}) };
      for (const k of ['categories', 'ingredientCategories', 'zones']) {
        if (!Array.isArray(this.settings[k]) || !this.settings[k].length) this.settings[k] = DEFAULT_SETTINGS[k];
      }
      if (!Array.isArray(this.settings.staff)) this.settings.staff = [];
    });
    this._unsubs.push(onSnapshot(this.ref('config', 'security'), (s) => { this.security = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(this.ref('config', 'counters'), (s) => { this.counters = s.exists() ? s.data() : {}; }, () => {}));
    this._unsubs.push(onSnapshot(doc(db, 'system', 'announcement'), (s) => { this.announcement = s.exists() ? s.data() : null; this.emit('announcement'); }, () => {}));
    listen(this.col('ingredients'), 'ingredients', (s) => { this.ingredients = rows(s).sort(byName); this._ingMap = null; });
    listen(this.col('products'), 'products', (s) => {
      this.products = rows(s).sort((a, b) => (a.sort ?? 999) - (b.sort ?? 999) || byName(a, b));
    });
    listen(this.col('tables'), 'tables', (s) => { this.tables = rows(s).sort(byName); });
    listen(query(this.col('orders'), where('status', '==', 'open')), 'orders', (s) => {
      this.orders = rows(s).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    });
    listen(query(this.col('tickets'), where('active', '==', true)), 'tickets', (s) => {
      this.tickets = rows(s).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    });
    listen(this.col('customers'), 'customers', (s) => { this.customers = rows(s).sort(byName); });
    listen(query(this.col('cash_shifts'), where('status', '==', 'open')), 'shift', (s) => {
      this.openShift = rows(s).sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || ''))[0] || null;
    });
    const since = startOfDay(addDays(new Date(), -7)).toISOString();
    listen(query(this.col('sales'), where('date', '>=', since)), 'sales', (s) => {
      this.recentSales = rows(s).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    });

    // Nunca bloquear más de 8 s (p. ej. sin internet y sin caché)
    await Promise.race([readyP, new Promise((r) => setTimeout(r, 8000))]);
    this.ready = true;
  }

  stop() {
    this._unsubs.forEach((u) => { try { u(); } catch (_) {} });
    this._unsubs = [];
    this.ready = false;
    this.tenant = null; this.ingredients = []; this.products = []; this.tables = []; this.orders = [];
    this.tickets = []; this.customers = []; this.openShift = null; this.recentSales = [];
    this.settings = { ...DEFAULT_SETTINGS }; this.security = {}; this.counters = {}; this._ingMap = null;
  }

  // ---------- Ajustes ----------
  get rate() { return Number(this.settings.rate) || 0; }
  get businessName() { return this.settings.businessName || this.tenant?.name || 'Mi restaurante'; }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await this.save('config', 'settings', patch, true);
    this.emit('settings');
  }
  async setRate(rate, auto = false) {
    const v = Number(rate);
    if (!(v > 0)) throw new Error('Tasa inválida');
    await this.saveSettings({ rate: v, rateUpdatedAt: new Date().toISOString(), rateSource: auto ? 'bcv' : 'manual' });
    this.emit('rate', v);
  }

  /** Número corto del pedido del día (1, 2, 3…) para la cocina y el cliente */
  nextOrderNo(b) {
    const day = todayKey();
    const n = this.counters.day === day ? (Number(this.counters.n) || 0) + 1 : 1;
    this.counters = { day, n };
    b.set(this.ref('config', 'counters'), { day, n }, { merge: true });
    return n;
  }

  // ---------- PIN de administrador ----------
  hasPin() { return !!this.security.pinHash; }
  async verifyPin(pin) {
    if (!this.security.pinHash) {
      const s = await getDoc(this.ref('config', 'security')).catch(() => null);
      if (s?.exists()) this.security = s.data();
    }
    if (!this.security.pinHash) return true;
    return (await sha256(`${this.tenantId}:${pin}`)) === this.security.pinHash;
  }
  async setPin(pin) {
    const pinHash = await sha256(`${this.tenantId}:${pin}`);
    this.security = { ...this.security, pinHash, updatedAt: new Date().toISOString() };
    await this.save('config', 'security', this.security, true);
  }

  // ---------- Búsquedas ----------
  ingredient(id) {
    if (!this._ingMap) this._ingMap = new Map(this.ingredients.map((i) => [i.id, i]));
    return this._ingMap.get(id);
  }
  product(id) { return this.products.find((p) => p.id === id); }
  customer(id) { return this.customers.find((c) => c.id === id); }
  table(id) { return this.tables.find((t) => t.id === id); }
  order(id) { return this.orders.find((o) => o.id === id); }
  orderForTable(tableId) { return this.orders.find((o) => o.type === 'mesa' && o.tableId === tableId); }

  // ---------- Recetas ----------
  /** Receta efectiva de un producto (según tamaño/variante) */
  recipeOf(product, variantId = null) {
    if (!product) return [];
    if (variantId && Array.isArray(product.variants)) {
      const v = product.variants.find((x) => x.id === variantId);
      if (v) return v.recipe || [];
    }
    return product.recipe || [];
  }
  /** Costo en $ de una receta según el costo actual de cada insumo */
  recipeCost(recipe) {
    return round4((recipe || []).reduce((a, r) => a + (Number(this.ingredient(r.ingredientId)?.cost) || 0) * (Number(r.qty) || 0), 0));
  }
  /** Consumo total de insumos de una línea del pedido: Map(ingredientId → cantidad) */
  lineConsumption(line, into = new Map()) {
    const p = this.product(line.productId);
    const qty = Number(line.qty) || 0;
    const add = (recipe) => (recipe || []).forEach((r) => {
      if (!r.ingredientId) return;
      into.set(r.ingredientId, round4((into.get(r.ingredientId) || 0) + (Number(r.qty) || 0) * qty));
    });
    add(line.recipe || this.recipeOf(p, line.variantId));
    for (const ex of line.extras || []) {
      const def = p?.extras?.find((x) => x.id === ex.id);
      add(ex.recipe || def?.recipe);
    }
    return into;
  }
  consumptionOf(lines) {
    const m = new Map();
    for (const l of lines || []) this.lineConsumption(l, m);
    return m;
  }
  /** Cuántas unidades se pueden preparar con el stock actual (Infinity si no lleva insumos) */
  canMake(product, variantId = null) {
    const recipe = this.recipeOf(product, variantId);
    let max = Infinity;
    for (const r of recipe) {
      const ing = this.ingredient(r.ingredientId);
      const q = Number(r.qty) || 0;
      if (!ing || q <= 0) continue;
      max = Math.min(max, Math.floor(Math.max(0, Number(ing.stock) || 0) / q + 1e-9));
    }
    return max;
  }
  /** Lista de faltantes si se vende el carrito: [{ing, need, have}] */
  shortages(lines, alreadyCommitted = []) {
    const need = this.consumptionOf(lines);
    const out = [];
    for (const [id, q] of need) {
      const ing = this.ingredient(id);
      if (!ing) continue;
      const have = Number(ing.stock) || 0;
      if (q > have + 1e-9) out.push({ ing, need: q, have });
    }
    return out;
  }

  // ---------- Alertas de stock ----------
  get lowIngredients() {
    return this.ingredients.filter((i) => i.active !== false && (Number(i.stock) || 0) <= (Number(i.minStock) || 0));
  }
  get outIngredients() { return this.ingredients.filter((i) => i.active !== false && (Number(i.stock) || 0) <= 0); }

  // ---------- Consultas ----------
  async salesBetween(fromISO, toISO) {
    const s = await getDocs(query(this.col('sales'), where('date', '>=', fromISO), where('date', '<=', toISO)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listBetween(name, fromISO, toISO) {
    const s = await getDocs(query(this.col(name), where('date', '>=', fromISO), where('date', '<=', toISO)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async listEq(name, field, value) {
    const s = await getDocs(query(this.col(name), where(field, '==', value)));
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  async closedShifts(max = 30) {
    const s = await getDocs(query(this.col('cash_shifts'), where('status', '==', 'closed')));
    return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.closedAt || '').localeCompare(a.closedAt || '')).slice(0, max);
  }
}

export const store = new Store();

// ---------- Administración de sedes (solo administrador general) ----------
export async function listTenants() {
  const s = await getDocs(collection(db, 'tenants'));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.code || a.name || '').localeCompare(b.code || b.name || '', 'es', { numeric: true }));
}
export async function updateTenant(id, data) { await setDoc(doc(db, 'tenants', id), data, { merge: true }); }
export async function tenantSalesSince(tenantId, fromISO) {
  const s = await getDocs(query(collection(db, 'tenants', tenantId, 'sales'), where('date', '>=', fromISO)));
  return s.docs.map((d) => d.data());
}
export async function getTenant(id) {
  const s = await getDoc(doc(db, 'tenants', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function createTenantDoc(id, data) { await setDoc(doc(db, 'tenants', id), data); }
export async function getUsername(username) {
  const s = await getDoc(doc(db, 'usernames', String(username).toLowerCase()));
  return s.exists() ? s.data() : null;
}
export async function setUsername(username, data) { await setDoc(doc(db, 'usernames', String(username).toLowerCase()), data); }
export async function deleteUsername(username) { await deleteDoc(doc(db, 'usernames', String(username).toLowerCase())); }
export async function setAnnouncement(data) { await setDoc(doc(db, 'system', 'announcement'), data); }
export async function getAnnouncement() {
  const s = await getDoc(doc(db, 'system', 'announcement'));
  return s.exists() ? s.data() : null;
}
export { DEFAULT_SETTINGS };
