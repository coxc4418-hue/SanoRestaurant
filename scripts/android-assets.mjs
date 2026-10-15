// Genera iconos (mipmap) y splash de Android a partir del logo
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const res = path.join(here, '..', 'apps', 'android', 'android', 'app', 'src', 'main', 'res');
const svg = readFileSync(path.join(here, '..', 'public', 'assets', 'logo.svg'), 'utf8');
// Primer plano: solo el dibujo blanco (sin el fondo)
const fg = svg.replace(/<rect width="512"[^>]*\/>/, '').replace(/<circle cx="400"[^>]*\/>/, '');
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage();
async function render(file, w, h, html) {
  await p.setViewport({ width: w, height: h });
  await p.setContent(`<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden">${html}</body></html>`);
  await p.screenshot({ path: file, omitBackground: true });
}
const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [d, s] of Object.entries(sizes)) {
  const dir = path.join(res, `mipmap-${d}`);
  const full = (r) => `<div style="width:${s}px;height:${s}px;border-radius:${r};overflow:hidden">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `).replace('rx="120"', 'rx="0"')}</div>`;
  await render(path.join(dir, 'ic_launcher.png'), s, s, full('22%'));
  await render(path.join(dir, 'ic_launcher_round.png'), s, s, full('50%'));
  const f = Math.round(s * 108 / 48); const inner = Math.round(f * 0.62);
  await render(path.join(dir, 'ic_launcher_foreground.png'), f, f, `<div style="width:${f}px;height:${f}px;display:grid;place-items:center">${fg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>`);
}
writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F05A1A</color>\n</resources>\n');
// Splash: fondo oscuro con el logo centrado
const pngSize = (f) => { const buf = readFileSync(f); return [buf.readUInt32BE(16), buf.readUInt32BE(20)]; };
for (const d of readdirSync(res).filter((x) => x.startsWith('drawable'))) {
  const f = path.join(res, d, 'splash.png');
  if (!existsSync(f)) continue;
  const [w, h] = pngSize(f); const s = Math.round(Math.min(w, h) * 0.28);
  await render(f, w, h, `<div style="width:${w}px;height:${h}px;background:#0d0b09;display:grid;place-items:center">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</div>`);
}
await b.close();
console.log('Iconos y splash de Android generados');
