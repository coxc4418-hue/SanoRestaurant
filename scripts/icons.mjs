// Genera los iconos PNG de la app a partir de public/assets/logo.svg
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, '..', 'public', 'assets');
const svg = readFileSync(path.join(assets, 'logo.svg'), 'utf8');
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
const shot = async (file, size, { pad = 0, bg = 'transparent', radius = true } = {}) => {
  await page.setViewport({ width: size, height: size });
  const inner = size - pad * 2;
  const s = radius ? svg : svg.replace('rx="120"', 'rx="0"');
  await page.setContent(`<html><body style="margin:0;background:${bg};display:grid;place-items:center;width:${size}px;height:${size}px">${s.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</body></html>`);
  await page.screenshot({ path: path.join(assets, file), omitBackground: bg === 'transparent' });
  console.log('✔', file);
};
await shot('icon-192.png', 192);
await shot('icon-512.png', 512);
await shot('favicon.png', 48);
await shot('apple-touch-icon.png', 180, { radius: false });
await shot('icon-maskable.png', 512, { radius: false });
await shot('icon-1024.png', 1024);
await browser.close();
