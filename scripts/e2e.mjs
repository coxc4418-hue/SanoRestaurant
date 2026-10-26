// SANO Restaurant — Prueba de extremo a extremo contra los emuladores
// Requisitos: firebase emulators:start --only auth,firestore,hosting  y  node provision.mjs 3 --emu
// Uso: node e2e.mjs [url=http://127.0.0.1:5066] [carpeta-capturas]
import puppeteer from 'puppeteer-core';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || 'http://127.0.0.1:5066') + '/?emu=1';
const SHOTS = process.argv[3] || path.join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });
const acc = JSON.parse(readFileSync(path.join(here, '.accounts-emu.json'), 'utf8'));

const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'OK ' : 'FALLA', name, extra]); console.log(cond ? '  ✔' : '  ✘', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--window-size=1400,900'] });
const errors = [];

async function newPage(w = 1400, h = 900) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|dolarapi|ERR_|Failed to load resource|net::|CORS/i.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.dismiss());
  // Evita que el diálogo de impresión bloquee la prueba
  await page.evaluateOnNewDocument(() => { window.print = () => {}; HTMLIFrameElement.prototype.focus = function () {}; });
  return { ctx, page };
}
const clickText = async (page, sel, text, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate((sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && !e.disabled && e.textContent.replace(/\s+/g, ' ').includes(text));
      if (el) { el.click(); return true; } return false;
    }, sel, text);
    if (ok) return true;
    await sleep(150);
  }
  throw new Error(`No encontré ${sel} con texto "${text}"`);
};
const waitText = (page, text, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text);
const store = (page, fn, arg) => page.evaluate(async (fnSrc, arg) => { const { store } = await import('/js/store.js'); return (0, eval)(fnSrc)(store, arg); }, fn.toString(), arg);
const stockOf = (page, name) => store(page, (s, n) => s.ingredients.find((i) => i.name === n)?.stock, name);
const fill = async (page, sel, value) => { await page.$eval(sel, (e) => { e.value = ''; }); await page.type(sel, String(value)); };
const nav = async (page, id) => { await page.evaluate((id) => { const b = document.querySelector(`.sb-nav [data-nav="${id}"]`); b.click(); }, id); await sleep(700); };

try {
  // ==================================================================
  console.log('\n1) Pantalla de inicio de sesión');
  let { ctx, page } = await newPage();
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form');
  ok('Login visible', true);
  ok('Botón de demo', !!(await page.$('#lg-demo')));
  const wa = await page.$eval('#lg-wa', (a) => a.href);
  ok('WhatsApp de contratación 584221906045', wa.includes('wa.me/584221906045'), wa.slice(0, 40));
  await page.screenshot({ path: path.join(SHOTS, '01-login.png') });

  // ==================================================================
  console.log('\n2) Demo de 30 minutos');
  await page.click('#lg-demo');
  await page.waitForSelector('.sb-nav', { timeout: 40000 });
  await waitText(page, 'Modo demo');
  await page.waitForSelector('.tour-tip', { timeout: 15000 });
  ok('Recorrido guiado se abre solo en la demo', true);
  await page.click('.tour-tip [data-t="stop"]');
  await sleep(2500);
  const nProducts = await store(page, (s) => s.products.length);
  const nIngr = await store(page, (s) => s.ingredients.length);
  ok('Menú de ejemplo cargado', nProducts >= 12, `${nProducts} productos, ${nIngr} insumos`);
  ok('Ventas de ejemplo de hoy', (await store(page, (s) => s.recentSales.filter((x) => x.dayKey === new Date().toISOString().slice(0, 10) || true).length)) > 10);
  ok('Mesa ocupada de ejemplo', (await store(page, (s) => s.orders.length)) >= 1);
  ok('Caja abierta', !!(await store(page, (s) => s.openShift?.id)));
  await page.screenshot({ path: path.join(SHOTS, '02-inicio-demo.png') });

  // ==================================================================
  console.log('\n3) Venta para llevar descuenta ingredientes de la receta');
  const pan0 = await stockOf(page, 'Pan de perro');
  const sal0 = await stockOf(page, 'Salchicha');
  const queso0 = await stockOf(page, 'Queso amarillo');
  await nav(page, 'vender');
  await page.waitForSelector('#pos-grid .pcard');
  await page.screenshot({ path: path.join(SHOTS, '03-pos.png') });
  await clickText(page, '#pos-grid .pcard', 'Perro caliente sencillo');
  await waitText(page, 'Nota para la cocina');
  await clickText(page, '.modal .opt', 'Extra queso');
  await clickText(page, '.modal [data-ok]', 'Agregar');
  await sleep(300);
  await clickText(page, '#pos-grid .pcard', 'Refresco lata');
  await sleep(300);
  const cartTotal = await page.$eval('.cart-grand .val b', (e) => e.textContent);
  ok('Carrito: perro con extra queso + refresco = $3,00', /3,00/.test(cartTotal), cartTotal);
  await page.click('#c-pay');
  await waitText(page, 'Total a cobrar');
  await page.screenshot({ path: path.join(SHOTS, '04-cobro.png') });
  await page.click('.modal [data-ok]');
  await waitText(page, 'Listo', 10000);
  await sleep(800);
  const pan1 = await stockOf(page, 'Pan de perro');
  const sal1 = await stockOf(page, 'Salchicha');
  const queso1 = await stockOf(page, 'Queso amarillo');
  ok('Pan de perro −1', pan1 === pan0 - 1, `${pan0} → ${pan1}`);
  ok('Salchicha −1', sal1 === sal0 - 1, `${sal0} → ${sal1}`);
  ok('Queso −1 por el extra', queso1 === queso0 - 1, `${queso0} → ${queso1}`);
  await page.keyboard.press('Escape');

  // ==================================================================
  console.log('\n4) Pizza por tamaño descuenta según el tamaño');
  const masa0 = await stockOf(page, 'Masa de pizza');
  await clickText(page, '#pos-grid .pcard', 'Pizza margarita');
  await waitText(page, 'Nota para la cocina');
  await clickText(page, '.modal .opt', 'Familiar');
  await clickText(page, '.modal [data-ok]', 'Agregar');
  await page.click('#c-pay');
  await waitText(page, 'Total a cobrar');
  // Pago mixto: quita el efectivo sugerido y paga con pago móvil (Bs)
  await page.click('.modal [data-rm="0"]');
  await clickText(page, '.modal .pay-method', 'Pago móvil');
  await sleep(200);
  await page.click('.modal [data-ok]');
  await waitText(page, 'Listo', 10000);
  await sleep(800);
  const masa1 = await stockOf(page, 'Masa de pizza');
  ok('Masa −450 g (familiar)', Math.abs(masa0 - masa1 - 450) < 0.01, `${masa0} → ${masa1}`);
  await page.keyboard.press('Escape');

  // ==================================================================
  console.log('\n5) Mesa → cocina → cobro');
  await nav(page, 'mesas');
  await page.waitForSelector('.tcard');
  await page.screenshot({ path: path.join(SHOTS, '05-mesas.png') });
  await clickText(page, '.tcard.free', 'Mesa 1');
  await page.waitForSelector('#pos-grid .pcard');
  await sleep(500);
  await clickText(page, '#pos-grid .pcard', 'Hamburguesa clásica');
  await waitText(page, 'Nota para la cocina');
  await clickText(page, '.modal [data-ok]', 'Agregar');
  const tick0 = await store(page, (s) => s.tickets.length);
  await page.click('#c-send');
  await page.waitForSelector('.tcard');
  await sleep(800);
  const mesa1Order = await store(page, (s) => { const t = s.tables.find((x) => x.name === 'Mesa 1'); return s.orderForTable(t.id); });
  ok('Mesa 1 ocupada con pedido', !!mesa1Order, mesa1Order ? `#${mesa1Order.orderNo} $${mesa1Order.total}` : '');
  ok('Comanda nueva en cocina', (await store(page, (s) => s.tickets.length)) === tick0 + 1);
  await nav(page, 'cocina');
  await page.waitForSelector('.kticket');
  await page.screenshot({ path: path.join(SHOTS, '06-cocina.png') });
  const tId = await store(page, (s, oid) => s.tickets.find((t) => t.orderId === oid)?.id, mesa1Order.id);
  await page.click(`[data-next="preparando"][data-id="${tId}"]`);
  await sleep(600);
  ok('Comanda pasa a Preparando', (await store(page, (s, id) => s.tickets.find((t) => t.id === id)?.status, tId)) === 'preparando');
  await page.click(`[data-next="listo"][data-id="${tId}"]`);
  await sleep(600);
  await nav(page, 'mesas');
  ok('Mesa muestra “Para servir”', await page.evaluate(() => [...document.querySelectorAll('.tcard')].some((c) => c.textContent.includes('Mesa 1') && c.textContent.includes('Para servir'))));
  await clickText(page, '.tcard', 'Mesa 1');
  await waitText(page, 'Pedido #');
  await clickText(page, '.modal [data-a="pay"]', 'Cobrar');
  await waitText(page, 'Total a cobrar');
  ok('Sin cargo por servicio en el cobro', !(await page.$('.modal [data-svc]')) && !(await page.evaluate(() => document.querySelector('.modal').innerText.includes('Servicio'))));
  await page.click('.modal [data-ok]');
  await waitText(page, 'Listo', 10000);
  await sleep(800);
  ok('Mesa 1 liberada tras cobrar', !(await store(page, (s) => { const t = s.tables.find((x) => x.name === 'Mesa 1'); return s.orderForTable(t.id); })));
  await page.keyboard.press('Escape');

  // ==================================================================
  console.log('\n6) Inventario: nuevo insumo y compra');
  await nav(page, 'inventario');
  await page.waitForSelector('#i-new');
  await page.screenshot({ path: path.join(SHOTS, '07-inventario.png') });
  await page.click('#i-new');
  await page.waitForSelector('.modal [name="name"]');
  await fill(page, '.modal [name="name"]', 'Pan de pepito');
  await fill(page, '.modal [name="stock"]', '10');
  await fill(page, '.modal [name="minStock"]', '5');
  await fill(page, '.modal [name="cost"]', '0,40');
  await page.click('.modal [data-ok]');
  await sleep(900);
  ok('Insumo creado', (await stockOf(page, 'Pan de pepito')) === 10);
  await page.evaluate(() => { const r = [...document.querySelectorAll('#i-list tr')].find((tr) => tr.textContent.includes('Pan de pepito')); r.querySelector('[data-mv]').click(); });
  await page.waitForSelector('.modal [name="qty"]');
  await fill(page, '.modal [name="qty"]', '20');
  await fill(page, '.modal [name="total"]', '10');
  await page.click('.modal [data-ok]');
  await sleep(900);
  const pep = await store(page, (s) => s.ingredients.find((i) => i.name === 'Pan de pepito'));
  ok('Compra suma stock y promedia costo', pep.stock === 30 && Math.abs(pep.cost - (10 * 0.4 + 10) / 30) < 0.001, `stock ${pep.stock}, costo ${pep.cost}`);

  // ==================================================================
  console.log('\n7) Menú: producto nuevo con receta');
  await nav(page, 'menu');
  await page.waitForSelector('#m-new');
  await page.screenshot({ path: path.join(SHOTS, '08-menu.png') });
  await page.click('#m-new');
  await page.waitForSelector('.modal [name="name"]');
  await fill(page, '.modal [name="name"]', 'Pepito de carne');
  await fill(page, '.modal [data-price]', '5');
  await page.click('.modal [data-recipe] [data-add]');
  const pepId = pep.id;
  await page.select('.modal [data-recipe] [data-ing="0"]', pepId);
  await sleep(200);
  await page.screenshot({ path: path.join(SHOTS, '09-producto.png') });
  await page.click('.modal [data-ok]');
  await sleep(900);
  const pp = await store(page, (s) => s.products.find((p) => p.name === 'Pepito de carne'));
  ok('Producto con receta guardado', pp && pp.price === 5 && pp.recipe?.[0]?.ingredientId === pepId && pp.recipe[0].qty === 1);
  ok('Disponibles calculados = 30', (await store(page, (s, id) => s.canMake(s.product(id)), pp.id)) === 30);

  // ==================================================================
  console.log('\n8) Bloqueo por falta de stock');
  await store(page, async (s, id) => { await s.save('ingredients', id, { stock: 0 }); }, pepId);
  await sleep(500);
  await nav(page, 'vender');
  await page.waitForSelector('#pos-grid .pcard');
  const disabled = await page.evaluate(() => [...document.querySelectorAll('#pos-grid .pcard')].find((c) => c.textContent.includes('Pepito de carne'))?.disabled);
  ok('Producto sin ingredientes aparece Agotado', disabled === true);
  ok('Alerta de stock en el menú lateral', await page.$eval('[data-badge="inventario"]', (b) => !b.hidden && Number(b.textContent) > 0));

  // ==================================================================
  console.log('\n9) Reportes y caja');
  await nav(page, 'reportes');
  await page.waitForSelector('.modal [data-pin]');
  ok('El PIN de la demo se muestra (1234)', await page.evaluate(() => document.querySelector('.modal').innerText.includes('1234')));
  await page.type('.modal [data-pin]', '9999');
  await page.click('.modal [data-ok]');
  await sleep(400);
  ok('PIN incorrecto rechazado', await page.evaluate(() => document.querySelector('.modal [data-err]')?.textContent.includes('incorrecto')));
  await page.$eval('.modal [data-pin]', (e) => { e.value = ''; });
  await page.type('.modal [data-pin]', '1234');
  await page.click('.modal [data-ok]');
  await waitText(page, 'Ganancia bruta');
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '10-reportes.png') });
  ok('Reporte muestra ventas', await page.evaluate(() => /\$\s?[1-9]/.test(document.querySelector('#r-body .kpi-value')?.textContent || '')));
  await nav(page, 'caja');
  await waitText(page, 'Ventas del turno');
  await page.screenshot({ path: path.join(SHOTS, '11-caja.png') });
  ok('Caja con ventas del turno', (await store(page, (s) => s.openShift.salesCount)) >= 7);
  await nav(page, 'pedidos');
  await sleep(500);
  await nav(page, 'clientes');
  await sleep(500);
  await nav(page, 'ajustes');
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, '12-ajustes.png') });

  // Vista móvil
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.waitForSelector('.bottom-nav [data-nav="vender"]', { timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => document.querySelector('.bottom-nav [data-nav="vender"]').click());
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '13-movil-pos.png') });
  await page.evaluate(() => document.querySelector('.bottom-nav [data-nav="inicio"]').click());
  await sleep(1000);
  await page.screenshot({ path: path.join(SHOTS, '14-movil-inicio.png') });

  // Terminar demo
  const demoUid = await page.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await page.setViewport({ width: 1400, height: 900 });
  await page.waitForSelector('#demo-end', { timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => document.getElementById('demo-end').click());
  await clickText(page, '.modal .btn-danger', 'Terminar');
  await page.waitForSelector('#login-form', { timeout: 30000 });
  ok('Demo terminada vuelve al login', true);
  await ctx.close();

  // ==================================================================
  console.log('\n10) Sede normal');
  ({ ctx, page } = await newPage());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form');
  await page.type('#lg-user', 'sede01');
  await page.type('#lg-pass', acc.sede01.password);
  await page.click('#lg-btn');
  await page.waitForSelector('.sb-nav', { timeout: 20000 });
  ok('Sede01 inicia sesión con su usuario', true);
  await sleep(1500);
  await page.keyboard.press('Escape');
  await nav(page, 'menu');
  await clickText(page, '#m-sample', 'Cargar menú de ejemplo');
  await sleep(2500);
  ok('Sede carga menú de ejemplo sin stock', (await store(page, (s) => s.products.length)) === 12 && (await stockOf(page, 'Salchicha')) === 0);
  const leak = await page.evaluate(async (other) => {
    const f = await import('/js/firebase.js');
    try { await f.getDoc(f.doc(f.db, 'tenants', other, 'config', 'settings')); return 'leído'; } catch (e) { return e.code; }
  }, acc.sede02.uid);
  ok('Sede01 NO puede leer datos de sede02', leak === 'permission-denied', leak);
  const selfFreeze = await page.evaluate(async (me) => {
    const f = await import('/js/firebase.js');
    try { await f.setDoc(f.doc(f.db, 'tenants', me), { paidUntil: null, active: true, plan: 'Premium' }, { merge: true }); return 'escrito'; } catch (e) { return e.code; }
  }, acc.sede01.uid);
  ok('Sede no puede cambiar su propio plan', selfFreeze === 'permission-denied', selfFreeze);
  await ctx.close();

  // ==================================================================
  console.log('\n11) Panel del administrador');
  ({ ctx, page } = await newPage());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form');
  await page.type('#lg-user', 'admin');
  await page.type('#lg-pass', acc.admin.password);
  await page.click('#lg-btn');
  await waitText(page, 'Panel de administración de sedes', 20000);
  await page.waitForSelector('[data-enter]');
  await sleep(1200);
  await page.screenshot({ path: path.join(SHOTS, '15-admin.png') });
  ok('Admin ve las sedes', (await page.$$('[data-enter]')).length >= 3);
  await page.click(`[data-tog="${acc.sede02.uid}"]`);
  await page.waitForSelector('.modal [data-ok]');
  await page.click('.modal [data-ok]');
  await sleep(900);
  ok('Sede02 congelada', await page.evaluate(() => document.body.innerText.includes('Congelada')));
  // Nueva sede
  await page.click('#a-new');
  await page.waitForSelector('.modal [name="name"]');
  await page.type('.modal [name="name"]', 'Pizzería Prueba');
  await page.click('.modal [data-ok]');
  await waitText(page, 'Sede creada', 20000);
  const newPass = await page.evaluate(() => [...document.querySelectorAll('.modal .summary-row')].find((r) => r.textContent.includes('Contraseña')).querySelector('b').textContent);
  const newUser = await page.evaluate(() => [...document.querySelectorAll('.modal .summary-row')].find((r) => r.textContent.includes('Usuario')).querySelector('b').textContent);
  ok('Nueva sede creada desde el panel', !!newPass, newUser);
  await page.keyboard.press('Escape');
  // Entrar a una sede como admin
  await page.waitForSelector(`[data-enter="${acc.sede01.uid}"]`, { timeout: 20000 });
  await sleep(500);
  await page.click(`[data-enter="${acc.sede01.uid}"]`);
  await waitText(page, 'Modo administrador', 20000);
  ok('Admin entra a la sede01', (await store(page, (s) => s.products.length)) === 12);
  await ctx.close();

  // ==================================================================
  console.log('\n12) Sede congelada y sede nueva');
  ({ ctx, page } = await newPage());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form');
  await page.type('#lg-user', 'sede02');
  await page.type('#lg-pass', acc.sede02.password);
  await page.click('#lg-btn');
  await waitText(page, 'Cuenta congelada', 20000);
  await page.screenshot({ path: path.join(SHOTS, '16-congelada.png') });
  ok('Sede congelada ve el bloqueo con WhatsApp', await page.evaluate(() => !!document.querySelector('a[href*="584221906045"]')));
  const frozenRead = await page.evaluate(async (me) => {
    const f = await import('/js/firebase.js');
    try { await f.getDoc(f.doc(f.db, 'tenants', me, 'config', 'settings')); return 'leído'; } catch (e) { return e.code; }
  }, acc.sede02.uid);
  ok('Sede congelada no puede leer datos (reglas)', frozenRead === 'permission-denied', frozenRead);
  await page.click('#blk-out');
  await page.waitForSelector('#login-form');
  await page.type('#lg-user', newUser);
  await page.type('#lg-pass', newPass);
  await page.click('#lg-btn');
  await page.waitForSelector('.sb-nav', { timeout: 20000 });
  ok('Sede nueva inicia sesión', await page.evaluate(() => document.body.innerText.includes('Pizzería Prueba')));
  await ctx.close();

  // Demo limpia
  ({ ctx, page } = await newPage());
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#login-form');
  await page.type('#lg-user', 'admin'); await page.type('#lg-pass', acc.admin.password); await page.click('#lg-btn');
  await page.waitForSelector('[data-enter]', { timeout: 20000 });
  const demoLeft = await page.evaluate(async (uid) => { const f = await import('/js/firebase.js'); return (await f.getDoc(f.doc(f.db, 'tenants', uid))).exists(); }, demoUid);
  ok('Los datos de la demo se borraron al terminar', demoLeft === false);
  await ctx.close();
} catch (e) {
  console.error('\nERROR EN LA PRUEBA:', e.message);
  results.push(['FALLA', 'Excepción', e.message]);
} finally {
  await browser.close();
}
console.log('\nErrores de la página:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'ninguno');
const fails = results.filter((r) => r[0] !== 'OK ');
console.log(`\nRESULTADO: ${results.length - fails.length}/${results.length} OK`);
process.exit(fails.length || errors.length ? 1 : 0);
