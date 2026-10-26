// SANO Restaurant — Prueba completa de un pedido de cada tipo: para llevar, mesa (2 rondas) y delivery.
// Verifica comandas, mesas, pedidos, descuento de ingredientes por receta, caja, cliente, anulación y recorrido guiado.
// Uso: node e2e-flows.mjs [url=http://127.0.0.1:5066] [carpeta-capturas]
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = (process.argv[2] || 'http://127.0.0.1:5066') + '/?emu=1';
const SHOTS = process.argv[3] || path.join(here, 'shots');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (name, cond, extra = '') => { results.push([cond, name]); console.log(cond ? '  ✔' : '  ✘', name, extra); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b) => Math.abs(a - b) < 0.011;
const errors = [];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox'] });
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|dolarapi|ERR_|Failed to load resource|net::|CORS/i.test(m.text())) errors.push(`console: ${m.text()}`); });
await page.evaluateOnNewDocument(() => { window.print = () => {}; });

const st = (fn, arg) => page.evaluate(async (src, arg) => { const { store } = await import('/js/store.js'); return (0, eval)(src)(store, arg); }, fn.toString(), arg);
const clickText = async (sel, text, timeout = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const done = await page.evaluate((sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null && !e.disabled && e.textContent.replace(/\s+/g, ' ').includes(text));
      if (el) { el.click(); return true; } return false;
    }, sel, text);
    if (done) return;
    await sleep(150);
  }
  throw new Error(`No encontré ${sel} con "${text}"`);
};
const waitText = (t, timeout = 15000) => page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, t);
const nav = async (id) => { await page.evaluate((id) => document.querySelector(`.sb-nav [data-nav="${id}"]`).click(), id); await sleep(800); };
const NAMES = { panHamb: 'Pan de hamburguesa', carne: 'Carne de hamburguesa 120 g', queso: 'Queso amarillo', repollo: 'Ensalada de repollo', salsas: 'Salsas de la casa', papas: 'Papas fritas congeladas', lata: 'Refresco lata 355 ml', envase: 'Envase para llevar', tocineta: 'Tocineta', panPerro: 'Pan de perro', salchicha: 'Salchicha', papitas: 'Papitas rayadas', masa: 'Masa de pizza', salsaPizza: 'Salsa para pizza', mozzarella: 'Queso mozzarella', pepperoni: 'Pepperoni' };
const stocks = () => st((s, names) => Object.fromEntries(Object.entries(names).map(([k, n]) => [k, s.ingredients.find((i) => i.name === n)?.stock])), NAMES);
function checkDelta(label, before, after, expected) {
  const bad = [];
  for (const k of Object.keys(NAMES)) {
    const want = expected[k] || 0;
    const got = Math.round((before[k] - after[k]) * 1000) / 1000;
    if (Math.abs(got - want) > 0.001) bad.push(`${NAMES[k]}: esperado −${want}, real −${got}`);
  }
  ok(`${label}: ingredientes descontados según receta`, !bad.length, bad.join(' | ') || Object.entries(expected).map(([k, v]) => `${k} −${v}`).join(', '));
}
const shift = () => st((s) => ({ total: s.openShift.salesTotal, count: s.openShift.salesCount, by: s.openShift.byMethod || {}, inUSD: s.openShift.inUSD, outBs: s.openShift.outBs }));
const maybePin = async () => { try { await page.waitForSelector('.modal [data-pin]', { timeout: 1500 }); await page.type('.modal [data-pin]', '1234'); await page.click('.modal [data-ok]'); await sleep(400); return true; } catch (_) { return false; } };
const pay = async () => { await page.click('.modal [data-ok]'); await waitText('Listo', 10000); await sleep(700); await page.keyboard.press('Escape'); await sleep(300); };

try {
  // ------------------------------------------------------------------
  console.log('\n0) Demo y recorrido guiado');
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('#lg-demo');
  ok('Login muestra el PIN de la demo', await page.evaluate(() => document.body.innerText.includes('PIN de la demo: 1234')));
  await page.click('#lg-demo');
  await page.waitForSelector('.tour-tip', { timeout: 45000 });
  let steps = 0;
  for (let i = 0; i < 30; i++) {
    const t = await page.$eval('.tour-tip .tour-title', (e) => e.textContent).catch(() => null);
    if (!t) break;
    steps++;
    if (i === 6) await page.screenshot({ path: path.join(SHOTS, 'flow-tour.png') });
    await page.click('.tour-tip [data-t="next"]');
    await sleep(900);
  }
  ok('Recorrido general completo', steps === 16, `${steps} pasos`);
  ok('Recorrido se cierra al terminar', !(await page.$('.tour')));
  // Recorridos por sección desde Ayuda
  for (const id of ['vender', 'mesas', 'menu', 'inventario', 'caja']) {
    await page.evaluate(() => document.getElementById('sb-help').click());
    await page.waitForSelector(`[data-tour-id="${id}"]`);
    await page.click(`[data-tour-id="${id}"]`);
    await page.waitForSelector('.tour-tip .tour-title', { timeout: 8000 });
    await sleep(500);
    let n = 0, lost = 0;
    for (let i = 0; i < 12; i++) {
      const has = await page.$('.tour-tip .tour-title');
      if (!has) break;
      n++;
      if (await page.evaluate(() => document.querySelector('.tour-tip').classList.contains('center'))) lost++;
      await page.click('.tour-tip [data-t="next"]');
      await sleep(1100);
    }
    ok(`Recorrido "${id}" ilumina cada zona`, n > 0 && lost === 0, `${n} pasos${lost ? `, ${lost} sin elemento` : ''}`);
  }
  await nav('inicio');

  // ------------------------------------------------------------------
  console.log('\n1) PARA LLEVAR: combo + refresco, pago móvil, comanda hasta entregar');
  let s0 = await stocks(); let sh0 = await shift();
  await nav('vender');
  await page.waitForSelector('#pos-grid .pcard');
  await clickText('#pos-grid .pcard', 'Combo hamburguesa');
  await clickText('#pos-grid .pcard', 'Refresco lata');
  await sleep(300);
  ok('Tipo “Para llevar” seleccionado', await page.$eval('.cart [data-type="llevar"]', (b) => b.classList.contains('on')));
  const tk0 = await st((s) => s.tickets.map((t) => t.id));
  await page.click('#c-pay');
  await waitText('Total a cobrar');
  ok('Total $7,00 (sin cargos extra)', (await page.$eval('.modal [data-total]', (e) => e.textContent)).includes('7,00'));
  await page.click('.modal [data-rm="0"]');
  await clickText('.modal .pay-method', 'Pago móvil');
  await page.screenshot({ path: path.join(SHOTS, 'flow-llevar-cobro.png') });
  await pay();
  checkDelta('Para llevar', s0, await stocks(), { panHamb: 1, carne: 1, queso: 1, repollo: 25, salsas: 40, papas: 150, lata: 2, envase: 1 });
  const llevarSale = await st((s) => s.recentSales.find((x) => x.type === 'llevar' && x.items.some((i) => i.name === 'Combo hamburguesa') && x.total === 7));
  ok('Venta registrada como “Para llevar”', !!llevarSale, llevarSale ? `#${llevarSale.orderNo}` : '');
  const tkL = await st((s, before) => s.tickets.find((t) => !before.includes(t.id)), tk0);
  ok('Comanda en cocina sin la bebida', tkL && tkL.label === 'Para llevar' && tkL.items.length === 1 && tkL.items[0].name === 'Combo hamburguesa', tkL ? tkL.items.map((i) => i.name).join(',') : 'sin comanda');
  await nav('cocina');
  for (const next of ['preparando', 'listo', 'entregado']) { await page.click(`[data-next="${next}"][data-id="${tkL.id}"]`); await sleep(500); }
  ok('Comanda recorre Pendiente → Preparando → Listo → Entregado', !(await st((s, id) => s.tickets.some((t) => t.id === id), tkL.id)));
  let sh1 = await shift();
  ok('Caja suma la venta y el pago móvil', near(sh1.total - sh0.total, 7) && near((sh1.by.pagomovil || 0) - (sh0.by.pagomovil || 0), 7));

  // ------------------------------------------------------------------
  console.log('\n2) MESA: dos rondas, comandas por ronda, pre-cuenta y cobro con vuelto');
  s0 = await stocks(); sh0 = await shift();
  await nav('mesas');
  await clickText('.tcard.free', 'Mesa 3');
  await page.waitForSelector('#pos-grid .pcard'); await sleep(400);
  ok('POS abre en modo Mesa con la Mesa 3', await page.evaluate(() => document.querySelector('#c-table')?.textContent.includes('Mesa 3')));
  await clickText('#pos-grid .pcard', 'Hamburguesa clásica');
  await waitText('Nota para la cocina');
  await clickText('.modal .opt', 'Tocineta');
  await page.type('.modal [data-note]', 'sin cebolla');
  await clickText('.modal [data-ok]', 'Agregar');
  await clickText('#pos-grid .pcard', 'Refresco lata');
  await page.evaluate(() => { const s = document.querySelector('#c-waiter'); if (s) { s.value = 'Carlos'; s.dispatchEvent(new Event('change')); } });
  await page.click('#c-send');
  await page.waitForSelector('#t-grid .tcard'); await sleep(700);
  let order = await st((s) => { const t = s.tables.find((x) => x.name === 'Mesa 3'); return s.orderForTable(t.id); });
  ok('Ronda 1: mesa ocupada con pedido', !!order && near(order.total, 6), order ? `#${order.orderNo} $${order.total}` : '');
  let tks = await st((s, id) => s.tickets.filter((t) => t.orderId === id), order.id);
  ok('Ronda 1: comanda con nota y extra, sin bebida', tks.length === 1 && tks[0].round === 1 && tks[0].items[0].note === 'sin cebolla' && tks[0].items[0].extras.includes('Tocineta') && tks[0].waiter === 'Carlos');
  checkDelta('Antes de cobrar la mesa', s0, await stocks(), {});
  ok('Tarjeta de la mesa muestra “En cocina” y el total', await page.evaluate(() => [...document.querySelectorAll('.tcard')].some((c) => c.textContent.includes('Mesa 3') && c.textContent.includes('En cocina') && c.textContent.includes('6,00'))));
  // Ronda 2
  await clickText('.tcard', 'Mesa 3');
  await waitText('Agregar productos');
  await page.click('.modal [data-a="add"]');
  await page.waitForSelector('#pos-grid .pcard'); await sleep(400);
  ok('Pedido abierto muestra lo ya enviado “En cocina”', await page.evaluate(() => document.querySelectorAll('.cline.sent').length === 2));
  await clickText('#pos-grid .pcard', 'Papas fritas');
  await waitText('Nota para la cocina');
  await clickText('.modal .opt', 'Grandes');
  await clickText('.modal [data-ok]', 'Agregar');
  await page.click('#c-send');
  await page.waitForSelector('#t-grid .tcard'); await sleep(700);
  order = await st((s, id) => s.order(id), order.id);
  tks = await st((s, id) => s.tickets.filter((t) => t.orderId === id).sort((a, b) => a.round - b.round), order.id);
  ok('Ronda 2: segunda comanda solo con lo nuevo', tks.length === 2 && tks[1].round === 2 && tks[1].items.length === 1 && tks[1].items[0].name === 'Papas fritas' && tks[1].items[0].variantName === 'Grandes');
  ok('Total de la mesa = $8,50', near(order.total, 8.5), `$${order.total}`);
  // Cocina marca listo la ronda 1 → mesa “Para servir”
  await nav('cocina');
  await page.click(`[data-next="preparando"][data-id="${tks[0].id}"]`); await sleep(400);
  await page.click(`[data-next="listo"][data-id="${tks[0].id}"]`); await sleep(400);
  await nav('mesas');
  ok('Mesa pasa a “Para servir”', await page.evaluate(() => [...document.querySelectorAll('.tcard')].some((c) => c.textContent.includes('Mesa 3') && c.textContent.includes('Para servir'))));
  await clickText('.tcard', 'Mesa 3');
  await waitText('Pre-cuenta');
  await page.click('.modal [data-a="pre"]');
  await page.click('.modal [data-a="pay"]');
  await waitText('Total a cobrar');
  ok('Cobro de mesa sin cargo por servicio: $8,50', (await page.$eval('.modal [data-total]', (e) => e.textContent)).includes('8,50') && !(await page.evaluate(() => document.querySelector('.modal').innerText.includes('Servicio'))));
  await page.$eval('.modal [data-amt="0"]', (e) => { e.value = ''; });
  await page.type('.modal [data-amt="0"]', '10');
  await sleep(300);
  ok('Muestra vuelto en Bs', await page.evaluate(() => document.querySelector('.modal [data-status]').textContent.includes('Vuelto')));
  await page.screenshot({ path: path.join(SHOTS, 'flow-mesa-cobro.png') });
  await pay();
  checkDelta('Mesa (2 rondas)', s0, await stocks(), { panHamb: 1, carne: 1, queso: 1, repollo: 25, salsas: 50, tocineta: 20, lata: 1, papas: 250 });
  const mesaSale = await st((s) => s.recentSales.find((x) => x.type === 'mesa' && x.tableName === 'Mesa 3'));
  ok('Venta de mesa con vuelto $1,50 en Bs', mesaSale && near(mesaSale.total, 8.5) && near(mesaSale.changeUSD, 1.5) && mesaSale.changeCurrency === 'BS' && mesaSale.waiter === 'Carlos');
  ok('Mesa 3 liberada y pedido cerrado', !(await st((s) => { const t = s.tables.find((x) => x.name === 'Mesa 3'); return s.orderForTable(t.id); })));
  sh1 = await shift();
  ok('Caja: +$8,50 neto (efectivo $10, vuelto Bs)', near(sh1.total - sh0.total, 8.5) && near((sh1.by.efectivo_usd || 0) - (sh0.by.efectivo_usd || 0), 10) && near((sh1.by.efectivo_bs || 0) - (sh0.by.efectivo_bs || 0), -1.5) && near(sh1.inUSD - sh0.inUSD, 10) && sh1.outBs > sh0.outBs);

  // ------------------------------------------------------------------
  console.log('\n3) DELIVERY: cliente, dirección, cobrar al entregar, costo de envío');
  s0 = await stocks(); sh0 = await shift();
  const cust0 = await st((s) => { const c = s.customers.find((x) => x.name === 'María González'); return { visits: c.visits || 0, spent: c.totalSpent || 0 }; });
  await nav('vender');
  await page.waitForSelector('#pos-grid .pcard');
  await page.click('.cart [data-type="delivery"]'); await sleep(300);
  await page.click('#c-cust');
  await page.waitForSelector('.modal [data-c]');
  await clickText('.modal [data-c]', 'María González');
  await sleep(300);
  ok('Dirección del cliente se carga sola', (await page.$eval('#c-addr', (e) => e.value)).includes('El Centro'));
  await clickText('#pos-grid .pcard', 'Pizza pepperoni');
  await waitText('Nota para la cocina');
  await clickText('.modal .opt', 'Mediana');
  await clickText('.modal [data-ok]', 'Agregar');
  await clickText('#pos-grid .pcard', 'Perro especial');
  await waitText('Nota para la cocina');
  await page.click('.modal [data-q="1"]');
  await clickText('.modal [data-ok]', 'Agregar');
  await sleep(300);
  ok('Carrito incluye el delivery: $16,50', (await page.$eval('.cart-grand .val b', (e) => e.textContent)).includes('16,50'));
  const tk1 = await st((s) => s.tickets.map((t) => t.id));
  await page.click('#c-save'); await sleep(900);
  const dOrder = await st((s) => s.orders.find((o) => o.type === 'delivery'));
  ok('Pedido delivery guardado para cobrar al entregar', dOrder && near(dOrder.deliveryFee, 1.5) && dOrder.address.includes('El Centro') && near(dOrder.total, 16.5));
  const tkD = await st((s, before) => s.tickets.find((t) => !before.includes(t.id)), tk1);
  ok('Comanda de delivery con el nombre del cliente', tkD && tkD.label === 'Delivery · María González' && tkD.items.length === 2);
  checkDelta('Delivery antes de cobrar', s0, await stocks(), {});
  await nav('pedidos');
  await page.waitForSelector(`[data-pay="${dOrder.id}"]`);
  await page.screenshot({ path: path.join(SHOTS, 'flow-pedidos.png') });
  await page.click(`[data-pay="${dOrder.id}"]`);
  await waitText('Total a cobrar');
  ok('Cobro muestra el costo de delivery', (await page.$eval('.modal [data-dfee]', (e) => e.value)) === '1,50' && (await page.$eval('.modal [data-total]', (e) => e.textContent)).includes('16,50'));
  await page.click('.modal [data-rm="0"]');
  await clickText('.modal .pay-method', 'Punto de venta');
  await pay();
  checkDelta('Delivery', s0, await stocks(), { masa: 300, salsaPizza: 100, mozzarella: 200, pepperoni: 70, panPerro: 2, salchicha: 2, queso: 4, tocineta: 30, repollo: 40, papitas: 30, salsas: 50 });
  const dSale = await st((s, id) => s.recentSales.find((x) => x.orderId === id), dOrder.id);
  ok('Venta delivery: $16,50 con envío $1,50', dSale && near(dSale.total, 16.5) && near(dSale.delivery, 1.5) && dSale.customerName === 'María González');
  ok('Pedido delivery cerrado', !(await st((s, id) => s.order(id), dOrder.id)));
  const cust1 = await st((s) => { const c = s.customers.find((x) => x.name === 'María González'); return { visits: c.visits || 0, spent: c.totalSpent || 0 }; });
  ok('Cliente suma visita y consumo', cust1.visits === cust0.visits + 1 && near(cust1.spent - cust0.spent, 16.5));
  const rc = await page.evaluate(async (id) => { const { receiptHTML } = await import('/js/shared.js'); const { store } = await import('/js/store.js'); return receiptHTML(store.recentSales.find((x) => x.id === id)); }, dSale.id);
  ok('Recibo con delivery y sin servicio', rc.includes('Delivery') && !rc.includes('Servicio') && rc.includes('El Centro'));

  // ------------------------------------------------------------------
  console.log('\n4) Anulación, ventas del día, reportes y caja');
  s0 = await stocks(); sh0 = await shift();
  await nav('pedidos');
  await page.click('[data-tab="sales"]'); await sleep(800);
  ok('Ventas del día listan los 3 pedidos', await page.evaluate((nums) => nums.every((n) => document.querySelector('#s-list').innerText.includes('#' + n)), [llevarSale.orderNo, mesaSale.orderNo, dSale.orderNo]));
  await page.click(`[data-view="${dSale.id}"]`);
  await waitText('Insumos descontados');
  await page.click('.modal [data-void]');
  await maybePin();
  await page.waitForSelector('.modal input.input:not([data-pin])', { timeout: 8000 });
  await page.type('.modal input.input', 'Cliente canceló');
  await clickText('.modal .btn-primary', 'Anular venta');
  await sleep(1200);
  const back = await stocks();
  ok('Anular devuelve los ingredientes', near(back.masa - s0.masa, 300) && near(back.salchicha - s0.salchicha, 2) && near(back.queso - s0.queso, 4));
  sh1 = await shift();
  ok('Anular resta la venta de la caja', near(sh0.total - sh1.total, 16.5) && near((sh0.by.punto || 0) - (sh1.by.punto || 0), 16.5));
  await nav('reportes');
  await maybePin();
  await waitText('Ganancia bruta'); await sleep(1500);
  const rep = await page.$eval('#r-body', (e) => e.innerText);
  ok('Reporte sin “Servicio” y con formas de pago', !rep.includes('Servicio') && rep.includes('Pago móvil'));
  await page.screenshot({ path: path.join(SHOTS, 'flow-reportes.png') });
  await nav('caja'); await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, 'flow-caja.png') });
  const methodsSum = await st((s) => Object.values(s.openShift.byMethod || {}).reduce((a, v) => a + v, 0) - s.openShift.salesTotal);
  ok('Caja: suma por forma de pago = total vendido', Math.abs(methodsSum) < 0.02, methodsSum.toFixed(3));
  await page.evaluate(() => document.querySelector('#k-close')?.click());
  await maybePin();
  await waitText('Diferencia en $');
  await page.click('.modal [data-ok]'); await sleep(1200);
  ok('Cierre de caja', !(await st((s) => s.openShift)));
  await page.keyboard.press('Escape');
} catch (e) {
  console.error('\nERROR EN LA PRUEBA:', e.message);
  results.push([false, 'Excepción: ' + e.message]);
  await page.screenshot({ path: path.join(SHOTS, 'flow-error.png') }).catch(() => {});
} finally {
  await browser.close();
}
console.log('\nErrores de la página:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'ninguno');
const fails = results.filter((r) => !r[0]);
console.log(`\nRESULTADO FLUJOS: ${results.length - fails.length}/${results.length} OK`);
process.exit(fails.length || errors.length ? 1 : 0);
