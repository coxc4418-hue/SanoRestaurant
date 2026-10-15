// SANO Restaurant — Menú, precios y recetas
import { store, unitShort, UNITS } from '../store.js';
import { requirePin } from '../auth.js';
import { esc, usd, bs, num, toast, openModal, confirmDialog, emptyState, normalize, debounce, parseNum, nowISO, shortId, round2, compressImage, setBusy } from '../utils.js';
import { icon } from '../icons.js';
import { ingredientForm } from './inventory.js';

export const FOOD_EMOJI = ['🌭', '🍔', '🍕', '🍟', '🌮', '🌯', '🥪', '🫓', '🥙', '🍗', '🍖', '🥩', '🧀', '🥓', '🍳', '🥗', '🍝', '🍜', '🍣', '🍤', '🥟', '🍩', '🍰', '🧁', '🍦', '🍫', '🥤', '🧃', '☕', '🍺', '🥛', '🧋', '🍹', '🍽️'];
const COLORS = ['', '#fde4cf', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff', '#a0c4ff', '#bdb2ff', '#ffc6ff', '#ffadad'];

export function mount(el, { navigate }) {
  let cat = 'Todos';
  let q = '';

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Menú y recetas</h1><p class="view-sub">Define el precio de cada producto y qué ingredientes consume. Al vender, el inventario se descuenta solo.</p></div>
      <div class="view-actions"><button class="btn btn-secondary" id="m-cats">${icon('tag')} Categorías</button><button class="btn btn-primary" id="m-new">${icon('plus')} Nuevo producto</button></div>
    </div>
    <div class="card card-flush">
      <div class="toolbar"><label class="search">${icon('search')}<input id="m-q" placeholder="Buscar producto…"></label></div>
      <div class="toolbar" style="padding-top:0;border-bottom:1px solid var(--border)"><div class="chips" id="m-chips" style="flex:1"></div></div>
      <div id="m-list"></div>
    </div>`;
  const $ = (s) => el.querySelector(s);

  function render() {
    const cats = ['Todos', ...new Set([...store.settings.categories, ...store.products.map((p) => p.category).filter(Boolean)])];
    if (!cats.includes(cat)) cat = 'Todos';
    $('#m-chips').innerHTML = cats.map((c) => {
      const n = c === 'Todos' ? store.products.length : store.products.filter((p) => p.category === c).length;
      return n || c === 'Todos' ? `<button class="chip ${c === cat ? 'on' : ''}" data-c="${esc(c)}">${esc(c)} <span class="count">${n}</span></button>` : '';
    }).join('');
    el.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => { cat = b.dataset.c; render(); });
    const nq = normalize(q);
    const list = store.products.filter((p) => (cat === 'Todos' || p.category === cat) && (!nq || normalize(p.name + ' ' + p.category).includes(nq)));
    if (!store.products.length) {
      $('#m-list').innerHTML = `<div style="padding:10px">${emptyState('burger', 'Tu menú está vacío', 'Crea tu primer producto, o carga un menú de ejemplo de comida rápida (perros, hamburguesas, pizzas, bebidas) con sus recetas e ingredientes para editarlo a tu gusto.')}
        <div class="row" style="justify-content:center;padding-bottom:24px"><button class="btn btn-secondary" id="m-sample">${icon('sparkle')} Cargar menú de ejemplo</button><button class="btn btn-primary" id="m-first">${icon('plus')} Crear producto</button></div></div>`;
      $('#m-first').onclick = () => productForm();
      $('#m-sample').onclick = async (e) => {
        setBusy(e.currentTarget, true, 'Cargando…');
        const { seedSampleMenu } = await import('../demo.js');
        await seedSampleMenu({ stock: false });
        toast('Menú de ejemplo cargado. Ajusta precios y carga el stock de tus insumos en Inventario.', 'success', 6000);
      };
      return;
    }
    $('#m-list').innerHTML = list.length ? `<div class="table-wrap"><table class="table">
      <thead><tr><th>Producto</th><th class="hide-sm">Receta</th><th class="r">Precio</th><th class="r hide-sm">Costo</th><th class="r hide-sm">Margen</th><th class="c">Disponibles</th><th class="c">Activo</th><th></th></tr></thead>
      <tbody>${list.map((p) => {
        const vs = p.variants?.length ? p.variants : null;
        const price = vs ? Math.min(...vs.map((v) => Number(v.price) || 0)) : Number(p.price) || 0;
        const cost = vs ? store.recipeCost(vs[0].recipe) : store.recipeCost(p.recipe);
        const basePrice = vs ? Number(vs[0].price) || 0 : price;
        const margin = basePrice > 0 ? (basePrice - cost) / basePrice * 100 : 0;
        const can = vs ? Math.max(...vs.map((v) => store.canMake(p, v.id))) : store.canMake(p);
        const recipe = vs ? vs[0].recipe || [] : p.recipe || [];
        return `<tr>
          <td><div class="row"><span class="emoji-box" style="background:${esc(p.color || '')}">${p.image ? `<img src="${esc(p.image)}" alt="">` : esc(p.emoji || '🍽️')}</span><div><div class="t-name">${esc(p.name)}</div><div class="t-sub">${esc(p.category || '')}${vs ? ` · ${vs.length} tamaños` : ''}${p.extras?.length ? ` · ${p.extras.length} extras` : ''}</div></div></div></td>
          <td class="hide-sm small muted" style="max-width:280px">${recipe.length ? recipe.map((r) => { const i = store.ingredient(r.ingredientId); return i ? `${num(r.qty, r.qty % 1 ? 2 : 0)} ${unitShort(i.unit)} ${esc(i.name)}` : '<span class="text-danger">insumo eliminado</span>'; }).join(', ') : '<span class="badge badge-warning">Sin receta</span>'}</td>
          <td class="r num nowrap">${vs ? '<span class="t-sub">desde</span>' : ''}<b>${usd(price)}</b><div class="t-sub text-bs">${bs(price * store.rate)}</div></td>
          <td class="r num hide-sm">${usd(cost)}</td>
          <td class="r hide-sm"><span class="badge ${margin >= 50 ? 'badge-success' : margin >= 30 ? 'badge-warning' : 'badge-danger'}">${num(margin, 0)}%</span></td>
          <td class="c">${can === Infinity ? '<span class="faint">—</span>' : `<span class="badge ${can <= 0 ? 'badge-danger' : can <= 5 ? 'badge-warning' : 'badge-success'}">${can}</span>`}</td>
          <td class="c"><label class="switch" title="Mostrar en el punto de venta"><input type="checkbox" data-av="${p.id}" ${p.available !== false ? 'checked' : ''}><span></span></label></td>
          <td class="r nowrap"><button class="btn btn-ghost btn-icon btn-sm" data-dup="${p.id}" title="Duplicar">${icon('copy')}</button><button class="btn btn-ghost btn-icon btn-sm" data-ed="${p.id}" title="Editar">${icon('edit')}</button></td>
        </tr>`;
      }).join('')}</tbody></table></div>` : `<div style="padding:10px">${emptyState('search', 'Sin resultados')}</div>`;
    el.querySelectorAll('[data-ed]').forEach((b) => b.onclick = () => productForm(store.product(b.dataset.ed)));
    el.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => { const p = store.product(b.dataset.dup); productForm({ ...structuredClone(p), id: null, name: p.name + ' (copia)' }); });
    el.querySelectorAll('[data-av]').forEach((i) => i.onchange = () => store.save('products', i.dataset.av, { available: i.checked, updatedAt: nowISO() }));
  }

  $('#m-new').onclick = () => productForm(cat !== 'Todos' ? { category: cat } : null);
  $('#m-cats').onclick = () => editCategories();
  $('#m-q').oninput = debounce((e) => { q = e.target.value; render(); }, 120);
  render();
  const off = store.on('*', (evt) => { if (['products', 'ingredients', 'settings', 'rate'].includes(evt)) render(); });
  return off;
}

// ======================================================================
// Editor de recetas reutilizable
// ======================================================================
function ingredientOptions(selected) {
  const groups = {};
  store.ingredients.filter((i) => i.active !== false || i.id === selected).forEach((i) => (groups[i.category || 'Otros'] ||= []).push(i));
  return `<option value="">Elige un ingrediente…</option>` + Object.entries(groups).map(([g, items]) => `<optgroup label="${esc(g)}">${items.map((i) => `<option value="${i.id}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)} (${unitShort(i.unit)})</option>`).join('')}</optgroup>`).join('');
}

/** Monta un editor de receta dentro de `host`. recipe es un arreglo mutable. onChange() se llama al editar. */
function recipeEditor(host, recipe, onChange, { compact = false } = {}) {
  function render() {
    host.innerHTML = `<div class="recipe">
      ${recipe.length ? `<div class="recipe-row recipe-head"><span>Ingrediente</span><span>Cantidad</span><span>Unidad</span><span class="cost r">Costo</span><span></span></div>` : ''}
      ${recipe.map((r, i) => {
        const ing = store.ingredient(r.ingredientId);
        return `<div class="recipe-row">
          <select class="select input-sm" data-ing="${i}">${ingredientOptions(r.ingredientId)}</select>
          <input class="input input-sm" data-qty="${i}" inputmode="decimal" value="${r.qty ? String(r.qty).replace('.', ',') : ''}" placeholder="0">
          <span class="unit">${ing ? unitShort(ing.unit) : ''}</span>
          <span class="cost">${ing ? usd((Number(ing.cost) || 0) * (Number(r.qty) || 0)) : ''}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="Quitar">${icon('x')}</button>
        </div>`;
      }).join('')}
      <div class="row row-wrap">
        <button type="button" class="btn btn-soft btn-sm" data-add>${icon('plus')} Agregar ingrediente</button>
        ${compact ? '' : `<button type="button" class="btn btn-ghost btn-sm" data-newing>${icon('box')} Crear insumo nuevo</button>`}
        <span class="grow"></span>
        ${recipe.length ? `<span class="small muted">Costo: <b class="num">${usd(store.recipeCost(recipe))}</b></span>` : ''}
      </div>
    </div>`;
    host.querySelectorAll('[data-ing]').forEach((s) => s.onchange = () => { recipe[+s.dataset.ing].ingredientId = s.value; if (!recipe[+s.dataset.ing].qty) recipe[+s.dataset.ing].qty = 1; render(); onChange(); });
    host.querySelectorAll('[data-qty]').forEach((s) => {
      s.oninput = () => { recipe[+s.dataset.qty].qty = parseNum(s.value); onChange(); const ing = store.ingredient(recipe[+s.dataset.qty].ingredientId); const c = s.parentElement.querySelector('.cost'); if (ing && c) c.textContent = usd((Number(ing.cost) || 0) * parseNum(s.value)); };
      s.onblur = () => render();
    });
    host.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { recipe.splice(+b.dataset.rm, 1); render(); onChange(); });
    host.querySelector('[data-add]').onclick = () => { recipe.push({ ingredientId: '', qty: 1 }); render(); host.querySelectorAll('[data-ing]')[recipe.length - 1]?.focus(); };
    const ni = host.querySelector('[data-newing]');
    if (ni) ni.onclick = async () => {
      const id = await ingredientForm(null, { quick: true });
      if (id) { recipe.push({ ingredientId: id, qty: 1 }); setTimeout(() => { render(); onChange(); }, 300); }
    };
  }
  render();
  return { render };
}

// ======================================================================
// Formulario de producto
// ======================================================================
export function productForm(p = null) {
  const isEdit = !!p?.id;
  const st = {
    name: p?.name || '', category: p?.category || store.settings.categories[0] || '', description: p?.description || '',
    emoji: p?.emoji || '🍔', image: p?.image || null, color: p?.color || '',
    kind: p?.kind || 'receta', resaleId: p?.kind === 'reventa' ? (p.recipe?.[0]?.ingredientId || '') : '',
    price: p?.price ?? '', recipe: structuredClone(p?.recipe || []),
    hasVariants: !!p?.variants?.length,
    variants: structuredClone(p?.variants || []),
    extras: structuredClone(p?.extras || []),
    kitchen: p?.kitchen !== false, available: p?.available !== false
  };
  const m = openModal({
    title: isEdit ? `Editar ${esc(p.name)}` : 'Nuevo producto', sub: 'Precio en dólares; el precio en bolívares se calcula con la tasa del día.', size: 'xl',
    body: `<form class="stack" data-f autocomplete="off">
      <div class="grid-main" style="grid-template-columns:1.3fr 1fr">
        <div class="stack">
          <div class="field"><label>Nombre del producto *</label><input class="input" name="name" value="${esc(st.name)}" placeholder="Ej.: Perro caliente especial" autofocus></div>
          <div class="form-grid">
            <div class="field"><label>Categoría</label><select class="select" name="category">${[...new Set([...store.settings.categories, st.category].filter(Boolean))].map((c) => `<option ${c === st.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ Nueva categoría…</option></select></div>
            <div class="field"><label>Tipo de producto</label><div class="seg seg-block"><button type="button" data-kind="receta">${icon('burger')} Preparado</button><button type="button" data-kind="reventa">${icon('box')} Reventa</button></div></div>
          </div>
          <div class="field"><label>Descripción (opcional)</label><input class="input" name="description" value="${esc(st.description)}" placeholder="Ej.: Salchicha, queso, papitas, salsas de la casa"></div>
        </div>
        <div class="stack">
          <div class="field"><label>Imagen</label>
            <div class="row"><span class="emoji-box" data-preview style="width:64px;height:64px;font-size:34px;border-radius:16px"></span>
              <div class="stack-sm grow"><label class="btn btn-secondary btn-sm">${icon('upload')} Subir foto<input type="file" accept="image/*" data-photo hidden></label><button type="button" class="btn btn-ghost btn-sm" data-nophoto>Usar emoji</button></div></div>
          </div>
          <div class="emoji-pick" data-emojis>${FOOD_EMOJI.map((e) => `<button type="button" data-e="${e}">${e}</button>`).join('')}</div>
          <div class="row">${COLORS.map((c) => `<button type="button" data-col="${c}" title="Color" style="width:26px;height:26px;border-radius:8px;border:1px solid var(--border-strong);background:${c || 'var(--surface-2)'}"></button>`).join('')}</div>
        </div>
      </div>

      <div data-sec-resale></div>
      <div data-sec-price></div>

      <div class="box">
        <div class="between"><div><div class="bold">Extras / adicionales</div><div class="small muted">Ej.: extra queso +$0,50 (descuenta 1 rebanada de queso)</div></div><button type="button" class="btn btn-soft btn-sm" data-addx>${icon('plus')} Agregar extra</button></div>
        <div data-extras class="stack-sm mt"></div>
      </div>

      <div class="form-grid">
        <label class="check box box-white"><span class="switch"><input type="checkbox" data-kitchen ${st.kitchen ? 'checked' : ''}><span></span></span><span><b>Enviar a cocina</b><br><small class="muted">Desactívalo para bebidas o productos listos.</small></span></label>
        <label class="check box box-white"><span class="switch"><input type="checkbox" data-avail ${st.available ? 'checked' : ''}><span></span></span><span><b>Disponible para vender</b><br><small class="muted">Ocúltalo temporalmente sin borrarlo.</small></span></label>
      </div>
      <div class="error-msg" data-err></div>
    </form>`,
    footer: `${isEdit ? `<button class="btn btn-danger-soft" data-del style="margin-right:auto">${icon('trash')} Eliminar</button>` : ''}<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${icon('check')} Guardar producto</button>`
  });
  const $ = (s) => m.el.querySelector(s);
  const F = $('[data-f]').elements;

  // Imagen / emoji / color
  function renderMedia() {
    const pv = $('[data-preview]');
    pv.style.background = st.color || '';
    pv.innerHTML = st.image ? `<img src="${st.image}" alt="">` : esc(st.emoji);
    m.el.querySelectorAll('[data-e]').forEach((b) => b.classList.toggle('on', !st.image && b.dataset.e === st.emoji));
    m.el.querySelectorAll('[data-col]').forEach((b) => b.style.outline = b.dataset.col === st.color ? '2px solid var(--brand)' : '');
  }
  m.el.querySelectorAll('[data-e]').forEach((b) => b.onclick = () => { st.emoji = b.dataset.e; st.image = null; renderMedia(); });
  m.el.querySelectorAll('[data-col]').forEach((b) => b.onclick = () => { st.color = b.dataset.col; renderMedia(); });
  $('[data-nophoto]').onclick = () => { st.image = null; renderMedia(); };
  $('[data-photo]').onchange = async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try { st.image = await compressImage(f, 360, 0.78); renderMedia(); } catch (_) { toast('No se pudo leer la imagen', 'danger'); }
  };
  F.category.onchange = async () => {
    if (F.category.value !== '__new') { st.category = F.category.value; return; }
    const { promptDialog } = await import('../utils.js');
    const name = (await promptDialog({ title: 'Nueva categoría', label: 'Nombre', placeholder: 'Ej.: Salchipapas' }))?.trim();
    if (name) {
      if (!store.settings.categories.includes(name)) await store.saveSettings({ categories: [...store.settings.categories, name] });
      st.category = name;
      F.category.insertAdjacentHTML('afterbegin', `<option>${esc(name)}</option>`);
    }
    F.category.value = st.category;
  };

  // Tipo
  function renderKind() {
    m.el.querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === st.kind));
    const sec = $('[data-sec-resale]');
    if (st.kind !== 'reventa') { sec.innerHTML = ''; renderPrice(); return; }
    st.hasVariants = false;
    sec.innerHTML = `<div class="box">
      <div class="bold">Producto de reventa</div>
      <div class="small muted mb">Se vende tal cual (refrescos, chucherías, agua). Cada venta descuenta 1 unidad de su insumo.</div>
      <div class="form-grid">
        <div class="field"><label>Insumo que se descuenta</label><select class="select" data-resale><option value="__auto">Crear insumo con el mismo nombre</option>${store.ingredients.map((i) => `<option value="${i.id}" ${i.id === st.resaleId ? 'selected' : ''}>${esc(i.name)} (${unitShort(i.unit)})</option>`).join('')}</select></div>
        <div class="field" data-autoinfo><label>Stock inicial · costo unitario ($)</label><div class="row"><input class="input" data-rstock inputmode="decimal" placeholder="Stock"><input class="input" data-rcost inputmode="decimal" placeholder="Costo $"></div></div>
      </div>
    </div>`;
    const sel = $('[data-resale]');
    if (!st.resaleId) sel.value = '__auto';
    const upd = () => { st.resaleId = sel.value === '__auto' ? '' : sel.value; $('[data-autoinfo]').hidden = !!st.resaleId; renderMargin(); };
    sel.onchange = upd; upd();
    renderPrice();
  }
  m.el.querySelectorAll('[data-kind]').forEach((b) => b.onclick = () => { st.kind = b.dataset.kind; renderKind(); });

  // Precio, tamaños y receta
  function renderPrice() {
    const sec = $('[data-sec-price]');
    if (st.kind === 'reventa') {
      sec.innerHTML = `<div class="box"><div class="form-grid"><div class="field"><label>Precio de venta ($) *</label><div class="input-group"><span class="prefix">$</span><input class="input" data-price inputmode="decimal" value="${st.price !== '' ? num(st.price) : ''}" placeholder="0,00"></div><span class="hint" data-pbs></span></div><div data-margin></div></div></div>`;
      bindPrice(); renderMargin(); return;
    }
    sec.innerHTML = `<div class="box">
      <div class="between row-wrap"><div><div class="bold">Precio y receta</div><div class="small muted">¿Se vende en varios tamaños? (pizzas, bebidas, combos)</div></div>
        <label class="check"><span class="switch"><input type="checkbox" data-hasv ${st.hasVariants ? 'checked' : ''}><span></span></span> Tiene tamaños</label></div>
      <div data-pricebody class="mt"></div>
    </div>`;
    $('[data-hasv]').onchange = (e) => {
      st.hasVariants = e.target.checked;
      if (st.hasVariants && !st.variants.length) {
        st.variants = [{ id: shortId(6), name: 'Personal', price: parseNum(st.price) || 0, recipe: structuredClone(st.recipe) }, { id: shortId(6), name: 'Familiar', price: round2((parseNum(st.price) || 0) * 1.8), recipe: st.recipe.map((r) => ({ ...r, qty: round2(r.qty * 2) })) }];
      }
      renderPrice();
    };
    const body = $('[data-pricebody]');
    if (!st.hasVariants) {
      body.innerHTML = `<div class="form-grid"><div class="field"><label>Precio de venta ($) *</label><div class="input-group"><span class="prefix">$</span><input class="input" data-price inputmode="decimal" value="${st.price !== '' ? num(st.price) : ''}" placeholder="0,00"></div><span class="hint" data-pbs></span></div><div data-margin></div></div>
        <div class="section-title mt">Receta (ingredientes por 1 unidad)</div><div data-recipe></div>`;
      bindPrice();
      recipeEditor($('[data-recipe]'), st.recipe, renderMargin);
      renderMargin();
    } else {
      body.innerHTML = `<div class="stack" data-vlist></div><button type="button" class="btn btn-soft btn-sm mt" data-addv>${icon('plus')} Agregar tamaño</button>`;
      const vl = $('[data-vlist]');
      st.variants.forEach((v, i) => {
        const card = document.createElement('div');
        card.className = 'variant-card';
        card.innerHTML = `<div class="row row-wrap">
            <input class="input" style="flex:1.2;min-width:140px" data-vn value="${esc(v.name)}" placeholder="Nombre del tamaño">
            <div class="input-group" style="flex:1;min-width:120px"><span class="prefix">$</span><input class="input" data-vp inputmode="decimal" value="${v.price !== '' ? num(v.price) : ''}" placeholder="Precio"></div>
            <span class="small muted" data-vm></span>
            <button type="button" class="btn btn-ghost btn-sm" data-vcopy title="Duplicar este tamaño">${icon('copy')}</button>
            <button type="button" class="btn btn-ghost btn-icon btn-sm" data-vdel title="Quitar tamaño">${icon('trash')}</button>
          </div><div data-vr></div>`;
        vl.appendChild(card);
        const vm = () => {
          const cost = store.recipeCost(v.recipe); const pr = Number(v.price) || 0;
          card.querySelector('[data-vm]').innerHTML = `Costo ${usd(cost)} · Margen <b>${pr > 0 ? num((pr - cost) / pr * 100, 0) : 0}%</b> · ${bs(pr * store.rate)}`;
        };
        card.querySelector('[data-vn]').oninput = (e) => { v.name = e.target.value; };
        card.querySelector('[data-vp]').oninput = (e) => { v.price = parseNum(e.target.value); vm(); };
        card.querySelector('[data-vdel]').onclick = () => { st.variants.splice(i, 1); if (!st.variants.length) st.hasVariants = false; renderPrice(); };
        card.querySelector('[data-vcopy]').onclick = () => { st.variants.splice(i + 1, 0, { ...structuredClone(v), id: shortId(6), name: v.name + ' 2' }); renderPrice(); };
        recipeEditor(card.querySelector('[data-vr]'), v.recipe ||= [], vm, { compact: true });
        vm();
      });
      $('[data-addv]').onclick = () => { st.variants.push({ id: shortId(6), name: '', price: '', recipe: [] }); renderPrice(); };
    }
  }
  function bindPrice() {
    const pi = $('[data-price]');
    const upd = () => { st.price = parseNum(pi.value); $('[data-pbs]').textContent = store.rate ? `${bs(st.price * store.rate)} a la tasa de hoy` : ''; renderMargin(); };
    pi.oninput = upd; upd();
  }
  function renderMargin() {
    const box = $('[data-margin]');
    if (!box) return;
    let cost;
    if (st.kind === 'reventa') {
      const ing = st.resaleId ? store.ingredient(st.resaleId) : null;
      cost = ing ? Number(ing.cost) || 0 : parseNum($('[data-rcost]')?.value);
    } else cost = store.recipeCost(st.recipe);
    const price = Number(st.price) || 0;
    const profit = price - cost;
    const pct = price > 0 ? profit / price * 100 : 0;
    box.innerHTML = `<div class="margin-bar"><div><div class="small muted">Costo</div><b class="num">${usd(cost)}</b></div><div><div class="small muted">Ganancia</div><b class="num ${profit < 0 ? 'text-danger' : 'text-success'}">${usd(profit)}</b></div><div><div class="small muted">Margen</div><b class="num">${num(pct, 0)}%</b></div></div>`;
  }
  m.el.addEventListener('input', (e) => { if (e.target.matches('[data-rcost]')) renderMargin(); });

  // Extras
  function renderExtras() {
    const host = $('[data-extras]');
    host.innerHTML = st.extras.map((x, i) => {
      const r = x.recipe?.[0] || { ingredientId: '', qty: 1 };
      const ing = store.ingredient(r.ingredientId);
      return `<div class="row row-wrap" style="background:var(--surface);padding:8px;border-radius:12px;border:1px solid var(--border)">
        <input class="input input-sm" style="flex:1.3;min-width:130px" data-xn="${i}" value="${esc(x.name)}" placeholder="Ej.: Extra queso">
        <div class="input-group" style="width:100px"><span class="prefix">$</span><input class="input input-sm" data-xp="${i}" inputmode="decimal" value="${x.price !== '' && x.price != null ? num(x.price) : ''}" placeholder="0,00"></div>
        <select class="select input-sm" style="flex:1.4;min-width:150px" data-xi="${i}">${ingredientOptions(r.ingredientId).replace('Elige un ingrediente…', 'Sin descontar insumo')}</select>
        <input class="input input-sm" style="width:70px" data-xq="${i}" inputmode="decimal" value="${String(r.qty || 1).replace('.', ',')}" title="Cantidad"><span class="small muted">${ing ? unitShort(ing.unit) : ''}</span>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-xdel="${i}">${icon('x')}</button>
      </div>`;
    }).join('');
    host.querySelectorAll('[data-xn]').forEach((s) => s.oninput = () => { st.extras[+s.dataset.xn].name = s.value; });
    host.querySelectorAll('[data-xp]').forEach((s) => s.oninput = () => { st.extras[+s.dataset.xp].price = parseNum(s.value); });
    host.querySelectorAll('[data-xi]').forEach((s) => s.onchange = () => { const x = st.extras[+s.dataset.xi]; x.recipe = s.value ? [{ ingredientId: s.value, qty: x.recipe?.[0]?.qty || 1 }] : []; renderExtras(); });
    host.querySelectorAll('[data-xq]').forEach((s) => s.oninput = () => { const x = st.extras[+s.dataset.xq]; if (x.recipe?.[0]) x.recipe[0].qty = parseNum(s.value); });
    host.querySelectorAll('[data-xdel]').forEach((b) => b.onclick = () => { st.extras.splice(+b.dataset.xdel, 1); renderExtras(); });
  }
  $('[data-addx]').onclick = () => { st.extras.push({ id: shortId(6), name: '', price: '', recipe: [] }); renderExtras(); m.el.querySelectorAll('[data-xn]')[st.extras.length - 1]?.focus(); };

  // Guardar
  const save = async (e) => {
    e?.preventDefault();
    const err = $('[data-err]'); err.textContent = '';
    st.name = F.name.value.trim();
    if (!st.name) { err.textContent = 'Escribe el nombre del producto.'; F.name.focus(); return; }
    if (store.products.some((x) => x.id !== p?.id && normalize(x.name) === normalize(st.name))) { err.textContent = 'Ya existe un producto con ese nombre.'; return; }
    const cleanRecipe = (r) => (r || []).filter((x) => x.ingredientId && Number(x.qty) > 0).map((x) => ({ ingredientId: x.ingredientId, qty: Number(x.qty) }));
    const data = {
      name: st.name, category: st.category === '__new' ? '' : st.category, description: F.description.value.trim(),
      emoji: st.emoji, image: st.image || null, color: st.color || '', kind: st.kind,
      kitchen: $('[data-kitchen]').checked, available: $('[data-avail]').checked,
      extras: st.extras.filter((x) => x.name.trim()).map((x) => ({ id: x.id || shortId(6), name: x.name.trim(), price: round2(x.price), recipe: cleanRecipe(x.recipe) })),
      updatedAt: nowISO()
    };
    const b = store.batch();
    if (st.kind === 'reventa') {
      if (!(Number(st.price) > 0)) { err.textContent = 'Indica el precio de venta.'; return; }
      let ingId = st.resaleId;
      if (!ingId) {
        const ref = store.newRef('ingredients');
        ingId = ref.id;
        b.set(ref, { name: st.name, unit: 'und', category: 'Bebidas', stock: parseNum($('[data-rstock]').value), minStock: 6, cost: parseNum($('[data-rcost]').value), supplier: '', active: true, createdAt: nowISO(), updatedAt: nowISO() });
      }
      Object.assign(data, { price: round2(st.price), recipe: [{ ingredientId: ingId, qty: 1 }], variants: [] });
    } else if (st.hasVariants) {
      const vs = st.variants.filter((v) => v.name.trim() || Number(v.price) > 0);
      if (!vs.length) { err.textContent = 'Agrega al menos un tamaño.'; return; }
      if (vs.some((v) => !v.name.trim())) { err.textContent = 'Cada tamaño necesita un nombre.'; return; }
      if (vs.some((v) => !(Number(v.price) > 0))) { err.textContent = 'Cada tamaño necesita un precio.'; return; }
      Object.assign(data, { variants: vs.map((v) => ({ id: v.id || shortId(6), name: v.name.trim(), price: round2(v.price), recipe: cleanRecipe(v.recipe) })), price: round2(Math.min(...vs.map((v) => Number(v.price)))), recipe: [] });
    } else {
      if (!(Number(st.price) > 0)) { err.textContent = 'Indica el precio de venta.'; return; }
      Object.assign(data, { price: round2(st.price), recipe: cleanRecipe(st.recipe), variants: [] });
    }
    if (!isEdit) { data.createdAt = nowISO(); }
    const ref = isEdit ? store.ref('products', p.id) : store.newRef('products');
    b.set(ref, data, { merge: true });
    const btn = $('[data-ok]'); setBusy(btn, true, 'Guardando…');
    await store.commit(b);
    m.close();
    const noRecipe = st.kind === 'receta' && (st.hasVariants ? data.variants.every((v) => !v.recipe.length) : !data.recipe.length);
    toast(noRecipe ? 'Producto guardado (sin receta: no descontará inventario)' : 'Producto guardado', noRecipe ? 'warning' : 'success', 4000);
  };
  $('[data-f]').onsubmit = save;
  $('[data-ok]').onclick = save;
  if (isEdit) $('[data-del]').onclick = async () => {
    if (!(await requirePin('Eliminar un producto'))) return;
    if (!(await confirmDialog({ title: 'Eliminar producto', message: `¿Eliminar <b>${esc(p.name)}</b> del menú? Las ventas anteriores no se modifican.`, confirmText: 'Eliminar', danger: true }))) return;
    await store.remove('products', p.id); m.close(); toast('Producto eliminado');
  };

  renderMedia(); renderKind(); renderExtras();
}

// ======================================================================
// Categorías del menú
// ======================================================================
function editCategories() {
  const cats = [...store.settings.categories];
  const m = openModal({
    title: 'Categorías del menú', sub: 'Ordénalas como quieres verlas en el punto de venta', size: 'sm',
    body: `<div class="stack"><div data-list class="stack-sm"></div><div class="row"><input class="input" data-new placeholder="Nueva categoría"><button class="btn btn-secondary" data-add>${icon('plus')}</button></div></div>`,
    footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>Guardar</button>`
  });
  const render = () => {
    m.el.querySelector('[data-list]').innerHTML = cats.map((c, i) => `<div class="row" style="padding:6px 10px;border:1px solid var(--border);border-radius:10px"><span class="grow">${esc(c)} <small class="muted">(${store.products.filter((p) => p.category === c).length})</small></span>
      <button class="btn btn-ghost btn-icon btn-sm" data-up="${i}" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button><button class="btn btn-ghost btn-icon btn-sm" data-rm="${i}">${icon('x')}</button></div>`).join('');
    m.el.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { const i = +b.dataset.up; [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]]; render(); });
    m.el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { cats.splice(+b.dataset.rm, 1); render(); });
  };
  const add = () => { const v = m.el.querySelector('[data-new]').value.trim(); if (v && !cats.includes(v)) cats.push(v); m.el.querySelector('[data-new]').value = ''; render(); };
  m.el.querySelector('[data-add]').onclick = add;
  m.el.querySelector('[data-new]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  m.el.querySelector('[data-ok]').onclick = async () => { await store.saveSettings({ categories: cats }); m.close(); toast('Categorías guardadas'); };
  render();
}

export { UNITS };
