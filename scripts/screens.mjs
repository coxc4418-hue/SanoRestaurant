// Genera las capturas del manifiesto (ventana de instalación de Chrome) desde la demo en producción
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'screens');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
await p.evaluateOnNewDocument(() => {
  localStorage.setItem('sr_install_hide', '1'); localStorage.setItem('sr_theme', 'dark');
  const st = document.createElement('style'); st.textContent = '.toasts,.demo-banner,[data-install]{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(st));
});
await p.goto('https://sano-restaurant.web.app', { waitUntil: 'networkidle2' });
await p.waitForSelector('#lg-demo'); await p.click('#lg-demo');
await p.waitForSelector('.sb-nav', { timeout: 60000 }); await sleep(5000);
const go = async (id, mobile) => { await p.evaluate((id, m) => document.querySelector(`${m ? '.bottom-nav' : '.sb-nav'} [data-nav="${id}"]`)?.click(), id, mobile); await sleep(1800); };
const shot = (f) => p.screenshot({ path: path.join(out, f) });
await go('vender'); await shot('pc-vender.png');
await go('inicio'); await shot('pc-inicio.png');
await go('cocina'); await shot('pc-cocina.png');
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
await p.waitForSelector('.bottom-nav [data-nav="vender"]', { timeout: 30000 }); await sleep(2500);
await go('vender', true); await shot('movil-vender.png');
await go('inicio', true); await shot('movil-inicio.png');
await go('mesas', true); await shot('movil-mesas.png');
// Terminar la demo (borra sus datos)
await p.setViewport({ width: 1280, height: 800 });
await p.waitForSelector('#demo-end', { timeout: 30000 }); await sleep(1500);
await p.evaluate(() => document.getElementById('demo-end').click());
await p.waitForSelector('.modal .btn-danger'); await p.click('.modal .btn-danger');
await p.waitForSelector('#login-form', { timeout: 60000 });
await b.close();
console.log('capturas listas');
