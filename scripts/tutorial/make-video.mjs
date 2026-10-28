// SANO Restaurant — Genera el video tutorial narrado (voz es-VE) grabando el sistema real.
// Requisitos: emuladores corriendo (o URL de producción), ffmpeg en el PATH y `pip install edge-tts`.
// Uso: node make-video.mjs [url=http://127.0.0.1:5066/?emu=1]
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = process.argv[2] || 'http://127.0.0.1:5066/?emu=1';
const WORK = path.join(here, 'work');
const OUT_DIR = path.join(here, '..', '..', 'public', 'tutorial');
mkdirSync(WORK, { recursive: true }); mkdirSync(OUT_DIR, { recursive: true });
const FFMPEG = execFileSync('where', ['ffmpeg']).toString().split(/\r?\n/)[0].trim();
const VOICE = 'es-VE-PaolaNeural';
const W = 1280, H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ======================================================================
// Guion: cada escena tiene la narración y las acciones que se graban
// ======================================================================
const SCENES = [
  { id: '01-intro', card: 'intro', text: 'Hola. Bienvenido a SANO Restaurant, el sistema para negocios de comida rápida: perros calientes, hamburguesas, pizzas y mucho más. En pocos minutos te muestro cómo usarlo.' },
  { id: '02-login', text: 'Para empezar, entra con el usuario y la contraseña de tu negocio. Si solo quieres probar, toca “Probar demo gratis”: tendrás treinta minutos con un negocio de ejemplo, y el PIN de la demo es uno, dos, tres, cuatro.',
    act: async (v, dur) => { await v.hl('#login-form', 4200); await v.hl('#lg-demo', 4600); await v.move('#lg-demo'); await sleep(Math.max(0, dur * 1000 - 11800)); await v.point('#lg-demo'); }, after: 'demo' },
  { id: '03-inicio', text: 'Esta es la pantalla de inicio. Aquí ves las ventas del día en dólares y en bolívares, los pedidos, la ganancia y lo que falta por cobrar. A la derecha aparecen las alertas cuando un ingrediente se está acabando. Y la tasa del día se actualiza sola con el Banco Central, aunque puedes cambiarla cuando quieras.',
    act: async (v) => { await v.hl('[data-tour="kpis"]', 5200); await v.hl('[data-tour="stock"]', 3800); await v.hl('#sb-rate', 3000); await v.move('#sb-rate'); } },
  { id: '04-menu', text: 'Lo más importante es el menú. Cada producto tiene su precio y su receta. Por ejemplo, el perro especial lleva un pan, una salchicha, dos rebanadas de queso, tocineta, papitas y salsas. El sistema calcula el costo, la ganancia y cuántos puedes preparar con lo que tienes en inventario.',
    act: async (v) => {
      await v.nav('menu'); await sleep(700);
      await v.pointRow('#m-list tr', 'Perro especial', '[data-ed]');
      await sleep(900); await v.scrollModalTo('[data-recipe]'); await v.hl('.modal [data-recipe]', 6000); await v.hl('.modal [data-margin]', 3000);
    }, after: 'closeModal' },
  { id: '05-inventario', text: 'En inventario están tus insumos: panes, salchichas, carne, queso, salsas, refrescos y envases. Cada uno tiene su existencia y su stock mínimo para avisarte a tiempo. Fíjate cuántos panes de perro y salchichas hay ahora.',
    act: async (v) => { await v.nav('inventario'); await sleep(600); await v.hl('#i-kpis', 3800); await v.hlRow('#i-list tr', 'Pan de perro', 3200); await v.hlRow('#i-list tr', 'Salchicha', 2600); } },
  { id: '06-venta', text: 'Vamos a vender. Toca un producto; si tiene extras, eliges los que pida el cliente, como queso adicional. Agregamos también un refresco. Ahora toca “Cobrar”. Puedes recibir dólares, bolívares, punto, pago móvil o Zelle, incluso combinados. Si el cliente paga con cinco dólares, el sistema calcula el vuelto en bolívares. ¡Listo!',
    act: async (v) => {
      await v.nav('vender'); await sleep(600);
      await v.pointText('#pos-grid .pcard', 'Perro especial'); await sleep(900);
      await v.pointText('.modal .opt', 'Extra queso'); await sleep(500);
      await v.pointText('.modal [data-ok]', 'Agregar'); await sleep(700);
      await v.pointText('#pos-grid .pcard', 'Refresco lata'); await sleep(900);
      await v.point('#c-pay'); await sleep(1200);
      await v.hl('.modal .pay-methods', 2600);
      await v.point('.modal [data-amt="0"]'); await v.page.keyboard.down('Control'); await v.page.keyboard.press('a'); await v.page.keyboard.up('Control');
      await v.page.keyboard.type('5', { delay: 120 }); await sleep(700);
      await v.hl('.modal [data-status]', 2000);
      await v.point('.modal [data-ok]'); await sleep(1600);
    }, after: 'closeModal' },
  { id: '07-descuento', text: 'Si volvemos al inventario, el pan de perro y la salchicha bajaron uno, y el queso bajó tres rebanadas: dos de la receta y una del extra. Así siempre sabes lo que te queda, sin contar a mano.',
    act: async (v) => { await v.nav('inventario'); await sleep(600); await v.hlRow('#i-list tr', 'Pan de perro', 3000); await v.hlRow('#i-list tr', 'Salchicha', 2600); await v.hlRow('#i-list tr', 'Queso amarillo', 3200); } },
  { id: '08-mesa', text: 'Para atender en mesa, toca una mesa libre. Agrega lo que piden, con notas para la cocina, como “sin cebolla”, y toca “Enviar”. La mesa queda ocupada y su comanda llega a la cocina.',
    act: async (v) => {
      await v.nav('mesas'); await sleep(700);
      await v.pointText('.tcard.free', 'Mesa 4'); await sleep(1200);
      await v.pointText('#pos-grid .pcard', 'Hamburguesa clásica'); await sleep(900);
      await v.point('.modal [data-note]'); await v.page.keyboard.type('sin cebolla', { delay: 70 }); await sleep(300);
      await v.pointText('.modal [data-ok]', 'Agregar'); await sleep(600);
      await v.pointText('#pos-grid .pcard', 'Papas fritas'); await sleep(800);
      await v.pointText('.modal .opt', 'Grandes'); await v.pointText('.modal [data-ok]', 'Agregar'); await sleep(600);
      await v.point('#c-send'); await sleep(1500);
      await v.hlText('.tcard', 'Mesa 4', 2200);
    } },
  { id: '09-cocina', text: 'En la cocina, las comandas llegan solas, con un sonido. Cada una muestra el número del pedido, la mesa, los productos y las notas. El cocinero toca “Empezar” y luego “Listo”, y el mesero sabe que ya puede servir.',
    act: async (v) => {
      await v.nav('cocina'); await sleep(800);
      const id = await v.page.evaluate(async () => { const { store } = await import('/js/store.js'); return store.tickets.find((t) => t.label === 'Mesa 4')?.id; });
      await v.hl(`[data-id="${id}"]`, 3500, (el) => el.closest('.kticket'));
      await v.point(`[data-next="preparando"][data-id="${id}"]`); await sleep(1800);
      await v.point(`[data-next="listo"][data-id="${id}"]`); await sleep(1500);
    } },
  { id: '10-cobro-mesa', text: 'Cuando el cliente pide la cuenta, abre la mesa. Puedes imprimir la pre-cuenta, agregar más productos, pasarla a otra mesa o cobrar. Al cobrar, la mesa se libera para el siguiente cliente.',
    act: async (v) => {
      await v.nav('mesas'); await sleep(700);
      await v.pointText('.tcard', 'Mesa 4'); await sleep(1200);
      await v.hl('.modal .grid-2', 3800);
      await v.point('.modal [data-a="pay"]'); await sleep(1300);
      await v.point('.modal [data-ok]'); await sleep(1800);
    }, after: 'closeModal' },
  { id: '11-delivery', text: 'Para un delivery, elige “Delivery” y el cliente: su dirección se carga sola. Agrega los productos y toca “Cobrar luego”. El pedido va a la cocina y queda en Pedidos, listo para cobrarlo cuando el repartidor entregue, con el costo del envío incluido.',
    act: async (v) => {
      await v.nav('vender'); await sleep(600);
      await v.point('.cart [data-type="delivery"]'); await sleep(700);
      await v.point('#c-cust'); await sleep(900);
      await v.pointText('.modal [data-c]', 'José Rodríguez'); await sleep(700);
      await v.hl('#c-addr', 1800);
      await v.pointText('#pos-grid .pcard', 'Pizza pepperoni'); await sleep(900);
      await v.pointText('.modal .opt', 'Familiar'); await v.pointText('.modal [data-ok]', 'Agregar'); await sleep(700);
      await v.point('#c-save'); await sleep(1400);
      await v.nav('pedidos'); await sleep(900);
      await v.hl('#o-body tbody tr', 3200);
    } },
  { id: '12-caja', text: 'En Caja abres el turno con el efectivo de fondo y registras los gastos, como el gas o una compra. Al cerrar, cuentas el dinero y el sistema te dice si sobra o falta, en dólares y en bolívares.',
    act: async (v) => { await v.nav('caja'); await sleep(800); await v.hl('#k-body .kpis', 5000); await v.hl('#k-out', 2400); await v.hl('#k-close', 2600); await v.move('#k-close'); } },
  { id: '13-reportes', text: 'Los reportes están protegidos con el PIN del dueño. Aquí ves las ventas, la ganancia real descontando el costo de los ingredientes, las horas pico, las formas de pago y lo más vendido. Todo se puede exportar a Excel o imprimir.',
    act: async (v) => {
      await v.navRaw('reportes'); await sleep(900);
      await v.point('.modal [data-pin]'); await v.page.keyboard.type('1234', { delay: 160 }); await sleep(300);
      await v.point('.modal [data-ok]'); await sleep(1600);
      await v.hl('#r-body .kpis', 4200); await v.hl('#r-body .grid-main > .stack:last-child', 3600);
      await v.point('[data-tab="products"]'); await sleep(2500);
    } },
  { id: '14-instalar', card: 'phone', text: 'Y lo mejor: SANO Restaurant se instala desde el navegador, en tu teléfono o en tu computadora, sin descargar nada de una tienda. Toca “Instalar app” y tendrás el ícono en tu pantalla. Todos tus equipos quedan conectados en tiempo real, y puedes imprimir recibos y comandas.' },
  { id: '15-ayuda', text: 'Si tienes dudas, en el menú “Ayuda y tutorial” encuentras recorridos guiados que te señalan cada parte de la pantalla, y este mismo video.',
    act: async (v) => { await v.nav('inicio'); await sleep(500); await v.point('#sb-help'); await sleep(1300); await v.hl('.modal .help-list', 3500); }, after: 'closeModal' },
  { id: '16-cierre', card: 'outro', text: '¿Listo para tu negocio? Escríbenos por WhatsApp al cero, cuatro, dos, dos, uno, nueve, cero, seis, cero, cuatro, cinco, y activa SANO Restaurant hoy mismo. ¡Gracias por ver!' }
];

// ======================================================================
// Voz
// ======================================================================
function tts(scene) {
  const h = createHash('md5').update(VOICE + scene.text).digest('hex').slice(0, 10);
  const mp3 = path.join(WORK, `${scene.id}-${h}.mp3`), srt = path.join(WORK, `${scene.id}-${h}.srt`);
  if (!existsSync(mp3)) execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=+3%', '--text', scene.text, '--write-media', mp3, '--write-subtitles', srt]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]).toString());
  return { mp3, srt, dur };
}

// ======================================================================
// Ayudas visuales: cursor animado, clic y resaltado
// ======================================================================
const OVERLAY = () => {
  const add = () => {
    if (document.getElementById('vcur')) return;
    const st = document.createElement('style');
    st.textContent = `#vcur{position:fixed;left:640px;top:360px;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:left .7s cubic-bezier(.2,.8,.2,1),top .7s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
      .vrip{position:fixed;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;border:3px solid #fb923c;z-index:2147483646;pointer-events:none;animation:vrip .6s ease-out forwards}
      @keyframes vrip{to{transform:scale(3.6);opacity:0}}
      .vhl{position:fixed;z-index:2147483645;pointer-events:none;border-radius:14px;border:3px solid #fb923c;box-shadow:0 0 0 4px rgba(251,146,60,.25),0 0 28px 6px rgba(251,146,60,.45);transition:opacity .3s;animation:vhl 1.4s ease-in-out infinite}
      @keyframes vhl{50%{box-shadow:0 0 0 7px rgba(251,146,60,.18),0 0 34px 10px rgba(251,146,60,.3)}}
      .toasts{top:auto!important;bottom:18px!important}`;
    document.head.appendChild(st);
    const c = document.createElement('div');
    c.id = 'vcur';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9.5-6.6 1.4L16 20.5l-3 1.4-3.6-7.6L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
};

function helpers(page) {
  const rectOf = async (sel, text = null, pick = null) => {
    const r = await page.evaluate((sel, text, pickSrc) => {
      const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
      let el = [...document.querySelectorAll(sel)].find((e) => vis(e) && (!text || e.textContent.replace(/\s+/g, ' ').includes(text)));
      if (!el) return null;
      if (pickSrc) el = (0, eval)(pickSrc)(el) || el;
      const b0 = el.getBoundingClientRect();
      if (b0.top < 0 || b0.bottom > innerHeight) el.scrollIntoView({ block: 'center', behavior: 'instant' });
      else el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    }, sel, text, pick ? pick.toString() : null);
    if (!r) console.warn('   (no encontré', sel, text || '', ')');
    return r;
  };
  const moveXY = async (x, y) => { await page.evaluate((x, y) => { const c = document.getElementById('vcur'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; } }, x, y); await sleep(760); };
  const v = {
    page,
    async move(sel, text) { const r = await rectOf(sel, text); if (r) await moveXY(r.x + r.w / 2, r.y + r.h / 2); return r; },
    async point(sel, text) {
      const r = await v.move(sel, text);
      if (!r) return;
      const x = r.x + r.w / 2, y = r.y + r.h / 2;
      await page.evaluate((x, y) => { const d = document.createElement('div'); d.className = 'vrip'; d.style.left = x + 'px'; d.style.top = y + 'px'; document.body.appendChild(d); setTimeout(() => d.remove(), 700); }, x, y);
      await page.mouse.click(x, y);
      await sleep(250);
    },
    pointText(sel, text) { return v.point(sel, text); },
    async pointRow(rowSel, text, btnSel) {
      const r = await rectOf(rowSel, text, (el) => el.querySelector('[data-ed]'));
      if (!r) return;
      await moveXY(r.x + r.w / 2, r.y + r.h / 2);
      await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    },
    async hl(sel, ms = 2500, pick = null, text = null) {
      const r = await rectOf(sel, text, pick);
      if (!r) { await sleep(ms); return; }
      await page.evaluate((r) => { const d = document.createElement('div'); d.className = 'vhl'; d.id = 'vhl-cur'; Object.assign(d.style, { left: r.x - 6 + 'px', top: r.y - 6 + 'px', width: r.w + 12 + 'px', height: r.h + 12 + 'px' }); document.body.appendChild(d); }, r);
      await sleep(ms);
      await page.evaluate(() => document.querySelectorAll('.vhl').forEach((d) => d.remove()));
    },
    hlText(sel, text, ms) { return v.hl(sel, ms, null, text); },
    hlRow(sel, text, ms) { return v.hl(sel, ms, null, text); },
    async scrollModalTo(sel) { await page.evaluate((sel) => document.querySelector('.modal ' + sel)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), sel); await sleep(700); },
    async nav(id) { await v.point(`.sb-nav [data-nav="${id}"]`); await sleep(500); },
    async navRaw(id) { await v.point(`.sb-nav [data-nav="${id}"]`); }
  };
  return v;
}

// ======================================================================
// Tarjetas (portada, instalación en teléfono, cierre)
// ======================================================================
const logo = readFileSync(path.join(here, '..', '..', 'public', 'assets', 'logo.svg'), 'utf8');
const CARD_CSS = `body{margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;
  background:radial-gradient(900px 500px at -10% -20%,#ff8a3d 0%,transparent 55%),radial-gradient(800px 500px at 110% 120%,#b91c1c 0%,transparent 55%),linear-gradient(150deg,#1b0f08,#2a130a 50%,#160b06)}
  .c{height:100%;display:flex;align-items:center;justify-content:center;gap:60px;text-align:left}
  .logo svg{width:150px;height:150px;border-radius:40px;box-shadow:0 30px 60px -20px rgba(0,0,0,.7);animation:pop .9s cubic-bezier(.2,.8,.2,1)}
  h1{font-size:64px;margin:0;letter-spacing:-2px;animation:up .9s .15s both} h1 em{font-style:normal;background:linear-gradient(90deg,#ffb27a,#ff6a3d);-webkit-background-clip:text;color:transparent}
  p{font-size:26px;margin:14px 0 0;opacity:.82;animation:up .9s .35s both} .tag{display:inline-block;margin-top:26px;padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.12);font-size:20px;animation:up .9s .55s both}
  @keyframes pop{from{transform:scale(.6);opacity:0}} @keyframes up{from{transform:translateY(22px);opacity:0}}`;
function cardHTML(kind) {
  if (kind === 'intro') return `<style>${CARD_CSS}</style><div class="c"><div class="logo">${logo}</div><div><h1>SANO <em>Restaurant</em></h1><p>Tutorial: cómo usar el sistema en tu negocio de comida</p><span class="tag">Punto de venta · Mesas · Cocina · Recetas e inventario · Caja en $ y Bs</span></div></div>`;
  if (kind === 'outro') return `<style>${CARD_CSS} .wa{display:inline-flex;align-items:center;gap:14px;margin-top:28px;padding:18px 28px;border-radius:18px;background:#16a34a;font-size:34px;font-weight:700;animation:up .9s .45s both;box-shadow:0 20px 40px -16px rgba(22,163,74,.8)}</style>
    <div class="c"><div class="logo">${logo}</div><div><h1>¿Listo para <em>tu negocio?</em></h1><p>Instálalo desde sano-restaurant.web.app</p><div class="wa">WhatsApp +58 422-190 6045</div></div></div>`;
  return `<style>${CARD_CSS} .phone{width:330px;height:640px;border-radius:46px;background:#000;padding:12px;box-shadow:0 40px 80px -24px rgba(0,0,0,.85),0 0 0 2px #333;animation:pop .9s cubic-bezier(.2,.8,.2,1)}
    .phone{position:relative;width:302px;height:648px;padding:12px;overflow:hidden} .phone img{position:absolute;left:12px;top:12px;width:302px;height:648px;object-fit:cover;object-position:top;border-radius:36px}
    .phone .s2{opacity:0;animation:fadein .8s 7s forwards} @keyframes fadein{to{opacity:1}}
    .steps{max-width:520px} .steps h1{font-size:50px} .st{display:flex;gap:16px;align-items:center;margin-top:22px;font-size:24px;animation:up .8s both} .st b{width:44px;height:44px;border-radius:14px;background:#ea580c;display:grid;place-items:center;flex:none}</style>
    <div class="c"><div class="phone"><img src="${PHONE[0]}"><img class="s2" src="${PHONE[1]}"></div><div class="steps"><h1>Instálalo <em>desde la web</em></h1>
    <div class="st" style="animation-delay:.4s"><b>1</b>Abre sano-restaurant.web.app en Chrome</div>
    <div class="st" style="animation-delay:1.6s"><b>2</b>Toca “Instalar app”</div>
    <div class="st" style="animation-delay:2.8s"><b>3</b>Listo: el ícono queda en tu pantalla</div>
    <div class="st" style="animation-delay:4s"><b>✓</b>Teléfono, tablet o computadora, conectados</div></div></div>`;
}

// ======================================================================
// Grabación
// ======================================================================
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', `--window-size=${W},${H}`, '--autoplay-policy=no-user-gesture-required'] });
const app = await browser.newPage();
await app.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await app.evaluateOnNewDocument(OVERLAY);
await app.evaluateOnNewDocument(() => { window.print = () => {}; try { localStorage.setItem('sr_install_hide', '1'); localStorage.setItem('sr_theme', 'dark'); localStorage.setItem('sr_ksound', '0'); } catch (_) {} });
const v = helpers(app);

// Capturas del teléfono (Android) para la escena de instalación
const PHONE = [];
{
  const ctx = await browser.createBrowserContext();
  const m = await ctx.newPage();
  await m.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
  await m.setViewport({ width: 390, height: 836, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(APP, { waitUntil: 'networkidle0' });
  await m.waitForSelector('.install-card'); await sleep(900);
  await m.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(300);
  PHONE.push('data:image/png;base64,' + (await m.screenshot({ encoding: 'base64' })));
  await m.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await m.evaluate(() => document.querySelector('.install-card [data-install]').click());
  await m.waitForSelector('.modal'); await sleep(700);
  await m.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  PHONE.push('data:image/png;base64,' + (await m.screenshot({ encoding: 'base64' })));
  await ctx.close();
}
await app.goto(APP, { waitUntil: 'networkidle0' });
await app.waitForSelector('#login-form');
await sleep(1200);

const parts = [];
for (const sc of SCENES) {
  const voice = tts(sc);
  console.log(`● ${sc.id} (${voice.dur.toFixed(1)} s)`);
  const webm = path.join(WORK, `${sc.id}.webm`);
  let page = app, cardPage = null;
  if (sc.card) {
    cardPage = await browser.newPage();
    await cardPage.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    await cardPage.setContent(cardHTML(sc.card), { waitUntil: 'load' });
    page = cardPage;
  }
  await page.bringToFront();
  await sleep(300);
  const rec = await page.screencast({ path: webm, ffmpegPath: FFMPEG });
  const t0 = Date.now();
  if (sc.act) { try { await sc.act(v, voice.dur); } catch (e) { console.warn('   acción:', e.message); } }
  const left = voice.dur * 1000 + 700 - (Date.now() - t0);
  if (left > 0) await sleep(left);
  await rec.stop();
  const total = Math.max(voice.dur + 0.7, (Date.now() - t0) / 1000);
  parts.push({ webm, ...voice, total });
  if (cardPage) await cardPage.close();
  // Acciones fuera de cámara
  if (sc.after === 'demo') {
    await app.waitForSelector('.sb-nav', { timeout: 90000 });
    await app.waitForSelector('.tour-tip', { timeout: 20000 }).catch(() => {});
    await app.evaluate(async () => (await import('/js/tour.js')).stopTour());
    await sleep(6000);
    await app.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  }
  if (sc.after === 'closeModal') { await app.keyboard.press('Escape'); await sleep(400); await app.keyboard.press('Escape'); await sleep(300); }
}
await browser.close();

// ======================================================================
// Montaje con ffmpeg: video + voz + subtítulos por escena, luego unión
// ======================================================================
const subStyle = "FontName=Segoe UI,FontSize=17,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,Shadow=0,MarginV=22,MarginL=60,MarginR=60";
const list = [];
for (const p of parts) {
  const mp4 = p.webm.replace('.webm', '.mp4');
  const srtName = path.basename(p.srt);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', p.webm, '-i', p.mp3,
    '-filter_complex', `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0d0b09,tpad=stop_mode=clone:stop_duration=5,subtitles=${srtName}:force_style='${subStyle}',setsar=1[v];[1:a]adelay=250|250,apad[a]`,
    '-map', '[v]', '-map', '[a]', '-t', p.total.toFixed(2), '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2', mp4], { cwd: WORK });
  list.push(`file '${mp4.replace(/\\/g, '/')}'`);
}
const listFile = path.join(WORK, 'lista.txt');
writeFileSync(listFile, list.join('\n'));
const final = path.join(OUT_DIR, 'sano-restaurant-tutorial.mp4');
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', final]);
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', '2.5', '-i', parts[0].webm.replace('.webm', '.mp4'), '-frames:v', '1', '-q:v', '3', path.join(OUT_DIR, 'portada.jpg')]);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', final]).toString());
console.log(`\n✔ Video listo: ${final} (${(dur / 60).toFixed(1)} min)`);
