// Prueba rápida contra producción (no deja datos: la demo se borra al terminar)
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const acc = JSON.parse(readFileSync(new URL('./.accounts.json', import.meta.url), 'utf8'));
const URL_ = 'https://sano-restaurant.web.app';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const errs = []; let fails = 0;
const ok = (n, c, x = '') => { console.log(c ? '  ✔' : '  ✘', n, x); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page() {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage();
  await p.setViewport({ width: 1366, height: 860 });
  p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p };
}
const st = (p, fn) => p.evaluate(async (src) => { const { store } = await import('/js/store.js'); return (0, eval)(src)(store); }, fn.toString());
try {
  let { ctx, p } = await page();
  await p.goto(URL_, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#lg-demo');
  ok('Producción carga el login', true);
  await p.click('#lg-demo');
  await p.waitForFunction(() => document.body.innerText.includes('Modo demo'), { timeout: 60000 });
  await sleep(4000);
  const n = await st(p, (s) => [s.products.length, s.ingredients.length, s.recentSales.length, s.rate]);
  ok('Demo real con datos', n[0] >= 12 && n[1] >= 20 && n[2] > 10, JSON.stringify(n));
  await p.screenshot({ path: process.argv[2] + '/prod-demo.png' });
  const uid = await p.evaluate(async () => (await import('/js/firebase.js')).auth.currentUser.uid);
  await p.evaluate(() => document.getElementById('demo-end').click());
  await p.waitForSelector('.modal .btn-danger'); await p.click('.modal .btn-danger');
  await p.waitForSelector('#login-form', { timeout: 60000 });
  ok('Demo terminada y limpiada', true, uid.slice(0, 6));
  await ctx.close();

  ({ ctx, p } = await page());
  await p.goto(URL_, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'sede01'); await p.type('#lg-pass', acc.sede01.password); await p.click('#lg-btn');
  await p.waitForSelector('.sb-nav', { timeout: 30000 });
  await sleep(2500);
  ok('sede01 entra en producción', true, 'tasa ' + (await st(p, (s) => s.rate)));
  await ctx.close();

  ({ ctx, p } = await page());
  await p.goto(URL_, { waitUntil: 'networkidle2' });
  await p.waitForSelector('#login-form');
  await p.type('#lg-user', 'admin'); await p.type('#lg-pass', acc.admin.password); await p.click('#lg-btn');
  await p.waitForSelector('[data-enter]', { timeout: 30000 });
  await sleep(3000);
  const count = await p.$$eval('[data-enter]', (x) => x.length);
  ok('Admin ve las 20 sedes', count === 20, String(count));
  const demoGone = await p.evaluate(async (u) => { const f = await import('/js/firebase.js'); return !(await f.getDoc(f.doc(f.db, 'tenants', u))).exists(); }, uid);
  ok('Sin rastros de la demo en la base de datos', demoGone);
  await p.screenshot({ path: process.argv[2] + '/prod-admin.png' });
  await ctx.close();
} catch (e) { console.log('ERROR', e.message); fails++; }
await b.close();
console.log('Errores de página:', errs.length ? errs.join(' | ') : 'ninguno');
console.log(fails ? `FALLAS: ${fails}` : 'PRODUCCIÓN OK');
process.exit(fails ? 1 : 0);
