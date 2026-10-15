// SANO Restaurant — Pantalla de cocina (comandas)
import { store } from '../store.js';
import { setTicketStatus } from '../ops.js';
import { esc, fmtAgo, minutesSince, qtyFmt, toast } from '../utils.js';
import { icon } from '../icons.js';
import { printKitchenTicket } from '../shared.js';

const COLS = [
  { id: 'pendiente', title: 'Pendientes', tone: 'badge-warning', next: 'preparando', nextLabel: 'Empezar', nextIcon: 'flame' },
  { id: 'preparando', title: 'Preparando', tone: 'badge-info', next: 'listo', nextLabel: 'Listo', nextIcon: 'check' },
  { id: 'listo', title: 'Listos para entregar', tone: 'badge-success', next: 'entregado', nextLabel: 'Entregado', nextIcon: 'arrowRight' }
];
const TYPE_ICON = { mesa: 'table', llevar: 'bag', delivery: 'truck' };

let audioCtx = null;
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
    o.start(); o.stop(audioCtx.currentTime + 0.36);
    setTimeout(() => { try { const o2 = audioCtx.createOscillator(); const g2 = audioCtx.createGain(); o2.connect(g2); g2.connect(audioCtx.destination); o2.frequency.value = 1175; g2.gain.setValueAtTime(0.2, audioCtx.currentTime); g2.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.3); o2.start(); o2.stop(audioCtx.currentTime + 0.31); } catch (_) {} }, 180);
  } catch (_) {}
}

export function mount(el) {
  let sound = true;
  try { sound = localStorage.getItem('sr_ksound') !== '0'; } catch (_) {}
  let known = new Set(store.tickets.map((t) => t.id));

  el.innerHTML = `
    <div class="view-header">
      <div><h1 class="view-title">Cocina</h1><p class="view-sub">Las comandas llegan solas al vender o al enviar un pedido de mesa.</p></div>
      <div class="view-actions">
        <button class="btn btn-secondary" id="k-sound"></button>
        <button class="btn btn-secondary" id="k-full">${icon('layers')} Pantalla completa</button>
      </div>
    </div>
    <div class="kboard" id="k-board"></div>`;
  const $ = (q) => el.querySelector(q);

  function renderSoundBtn() { $('#k-sound').innerHTML = `${icon('bell')} Sonido: ${sound ? 'activado' : 'apagado'}`; }

  function render() {
    $('#k-board').innerHTML = COLS.map((c) => {
      const list = store.tickets.filter((t) => t.status === c.id);
      return `<section class="kcol">
        <div class="kcol-head"><span>${c.title}</span><span class="badge ${c.tone}">${list.length}</span></div>
        <div class="kcol-list">${list.length ? list.map((t) => ticketHTML(t, c)).join('') : `<div class="empty" style="padding:26px 10px">${icon(c.id === 'listo' ? 'check' : 'chef')}<span>${c.id === 'pendiente' ? 'Sin comandas nuevas' : 'Nada por aquí'}</span></div>`}</div>
      </section>`;
    }).join('');
    el.querySelectorAll('[data-next]').forEach((b) => b.onclick = async () => {
      const t = store.tickets.find((x) => x.id === b.dataset.id);
      if (!t) return;
      b.disabled = true;
      await setTicketStatus(t, b.dataset.next);
      if (b.dataset.next === 'listo') toast(`#${t.orderNo} ${t.label} está listo`, 'success');
    });
    el.querySelectorAll('[data-back]').forEach((b) => b.onclick = async () => {
      const t = store.tickets.find((x) => x.id === b.dataset.id);
      if (t) await setTicketStatus(t, b.dataset.back);
    });
    el.querySelectorAll('[data-print]').forEach((b) => b.onclick = () => {
      const t = store.tickets.find((x) => x.id === b.dataset.print);
      if (t) printKitchenTicket(t);
    });
  }

  function ticketHTML(t, c) {
    const mins = minutesSince(t.createdAt);
    const cls = mins >= 20 ? 'late' : mins >= 10 ? 'warn' : '';
    const prev = COLS[COLS.findIndex((x) => x.id === c.id) - 1];
    return `<article class="kticket">
      <div class="kticket-head">
        <div><div class="kticket-no">#${esc(t.orderNo ?? '')}</div><div class="kticket-label row" style="gap:5px">${icon(TYPE_ICON[t.type] || 'bag')}${esc(t.label || '')}${t.round > 1 ? ` <span class="badge badge-neutral">Ronda ${t.round}</span>` : ''}</div></div>
        <div class="stack-sm" style="align-items:flex-end"><span class="kticket-time ${cls}">${fmtAgo(t.createdAt)}</span>${t.waiter ? `<span class="xs muted">${esc(t.waiter)}</span>` : ''}</div>
      </div>
      <div class="kticket-items">
        ${(t.items || []).map((i) => `<div class="kitem"><b>${qtyFmt(i.qty)}</b><div>${esc(i.emoji || '')} ${esc(i.name)}${i.variantName ? ` <span class="muted">· ${esc(i.variantName)}</span>` : ''}
          ${i.extras?.length ? `<small>+ ${i.extras.map(esc).join(', ')}</small>` : ''}
          ${i.note ? `<small class="note">⚠ ${esc(i.note)}</small>` : ''}</div></div>`).join('')}
        ${t.note ? `<div class="small text-warning bold">Nota: ${esc(t.note)}</div>` : ''}
      </div>
      <div class="kticket-foot">
        ${prev ? `<button class="btn btn-ghost btn-icon btn-sm" data-back="${prev.id}" data-id="${t.id}" title="Regresar a ${prev.title}">${icon('arrowLeft')}</button>` : ''}
        <button class="btn btn-ghost btn-icon btn-sm" data-print="${t.id}" title="Imprimir comanda">${icon('print')}</button>
        <button class="btn ${c.id === 'listo' ? 'btn-success' : 'btn-primary'} btn-sm" data-next="${c.next}" data-id="${t.id}">${icon(c.nextIcon)} ${c.nextLabel}</button>
      </div>
    </article>`;
  }

  $('#k-sound').onclick = () => { sound = !sound; try { localStorage.setItem('sr_ksound', sound ? '1' : '0'); } catch (_) {} renderSoundBtn(); if (sound) beep(); };
  $('#k-full').onclick = () => { const d = document.documentElement; (document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen?.())?.catch?.(() => {}); };
  renderSoundBtn();
  render();
  const off = store.on('tickets', () => {
    const fresh = store.tickets.filter((t) => !known.has(t.id) && t.status === 'pendiente');
    known = new Set(store.tickets.map((t) => t.id));
    if (fresh.length && sound) beep();
    render();
  });
  const timer = setInterval(render, 30000);
  return () => { off(); clearInterval(timer); };
}
