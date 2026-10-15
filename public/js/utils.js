// SANO Restaurant — Utilidades compartidas
import { icon } from './icons.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Números y moneda ----------
const nfCache = {};
export function num(n, d = 2) {
  const v = Number(n);
  if (!isFinite(v)) return d ? '0,' + '0'.repeat(d) : '0';
  const k = d;
  nfCache[k] ||= new Intl.NumberFormat('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d });
  return nfCache[k].format(Math.abs(v) < 0.005 && d === 2 ? 0 : v);
}
export const usd = (n) => `$ ${num(n)}`;
export const bs = (n) => `Bs ${num(n)}`;
export function qtyFmt(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : num(v, v * 100 % 1 === 0 ? 2 : 3);
}
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function round4(n) { return Math.round((Number(n) || 0) * 10000) / 10000; }
export function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v == null) return 0;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  // Soporta "1.234,56", "1234,56" y "1234.56"
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

// ---------- Fechas (hora local del dispositivo) ----------
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
export const todayKey = () => dayKey(new Date());
export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function fromKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
export function fmtDate(v) { if (!v) return '—'; const d = new Date(v.length === 10 ? fromKey(v) : v); return d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
export function fmtDateTime(v) { if (!v) return '—'; return new Date(v).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
export function fmtTime(v) { if (!v) return '—'; return new Date(v).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }); }
export function fmtLongDate(d = new Date()) { const t = d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
export const nowISO = () => new Date().toISOString();
/** "hace 5 min", "hace 1 h 20 min" */
export function fmtAgo(v) {
  if (!v) return '';
  const m = Math.max(0, Math.floor((Date.now() - new Date(v).getTime()) / 60000));
  if (m < 1) return 'ahora';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function minutesSince(v) { return v ? Math.max(0, (Date.now() - new Date(v).getTime()) / 60000) : 0; }
export function shortId(n = 8) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => a[x % a.length]).join('');
}

export function docNumber(prefix) {
  const d = new Date();
  const r = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefix}-${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${r}`;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function initials(name) {
  const w = String(name || '?').trim().split(/\s+/);
  const last = w[w.length - 1];
  if (w.length > 1 && /^\d+$/.test(last)) return last.slice(-2);
  return w.map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
}
export function colorFor(text) {
  let h = 0; for (const c of String(text || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${Math.round((h * 137.508) % 360)} 55% 42%)`;
}
export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ---------- Métodos de pago ----------
export const PAY_METHODS = {
  efectivo_usd: { label: 'Efectivo $', cur: 'USD', cash: true, color: '#16a34a' },
  efectivo_bs: { label: 'Efectivo Bs', cur: 'BS', cash: true, color: '#0891b2' },
  punto: { label: 'Punto de venta', cur: 'BS', cash: false, color: '#2563eb' },
  pagomovil: { label: 'Pago móvil', cur: 'BS', cash: false, color: '#7c3aed' },
  transferencia: { label: 'Transferencia', cur: 'BS', cash: false, color: '#4f46e5' },
  biopago: { label: 'Biopago', cur: 'BS', cash: false, color: '#db2777' },
  zelle: { label: 'Zelle / Binance', cur: 'USD', cash: false, color: '#0d9488' }
};
export const methodLabel = (m) => PAY_METHODS[m]?.label || m || 'Otro';

// ---------- Toasts ----------
export function toast(message, type = 'success', ms = 2800) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i></i><span>${esc(message)}</span>`;
  box.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, ms);
}

// ---------- Modales ----------
const modalStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    const top = modalStack[modalStack.length - 1];
    if (top.dismissible) top.close();
  }
});

/**
 * openModal({ title, sub, body, footer, size, dismissible, onClose }) → { el, close, body }
 * body/footer: HTML string. Devuelve el elemento para enlazar eventos.
 */
export function openModal({ title = '', sub = '', body = '', footer = '', size = '', dismissible = true, onClose } = {}) {
  const host = document.getElementById('modals');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${size ? 'modal-' + size : ''}" role="dialog" aria-modal="true">
      ${title ? `<div class="modal-header"><div><div class="modal-title">${title}</div>${sub ? `<div class="modal-sub">${sub}</div>` : ''}</div>
        ${dismissible ? `<button type="button" class="x-btn" data-close aria-label="Cerrar">${icon('x')}</button>` : ''}</div>` : ''}
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  host.appendChild(wrap);
  let closed = false;
  const api = {
    el: wrap,
    dismissible,
    close() {
      if (closed) return; closed = true;
      wrap.remove();
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      if (onClose) onClose();
    }
  };
  modalStack.push(api);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap && dismissible) api.close(); });
  wrap.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => api.close()));
  setTimeout(() => { if (wrap.contains(document.activeElement)) return; const f = wrap.querySelector('[autofocus]'); if (f) { f.focus(); if (f.select) f.select(); } }, 60);
  return api;
}
export function closeAllModals() { [...modalStack].forEach((m) => m.close()); }

export function confirmDialog({ title = '¿Confirmar?', message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'sm',
      body: `<p class="muted">${message}</p>`,
      footer: `<button class="btn btn-secondary" data-no>${cancelText}</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes autofocus>${confirmText}</button>`,
      onClose: () => { if (!done) resolve(false); }
    });
    m.el.querySelector('[data-no]').onclick = () => m.close();
    m.el.querySelector('[data-yes]').onclick = () => { done = true; m.close(); resolve(true); };
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', type = 'text', confirmText = 'Guardar' }) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title, size: 'sm',
      body: `<form class="stack" data-f><div class="field"><label>${label}</label><input class="input" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}" autofocus step="any"></div></form>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-primary" data-ok>${confirmText}</button>`,
      onClose: () => { if (!done) resolve(null); }
    });
    const submit = (e) => { e?.preventDefault(); done = true; const v = m.el.querySelector('input').value; m.close(); resolve(v); };
    m.el.querySelector('[data-f]').onsubmit = submit;
    m.el.querySelector('[data-ok]').onclick = submit;
  });
}

// ---------- Archivos ----------
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function toCSV(rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Punto y coma: Excel en español lo abre en columnas directamente
  return '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
}
export function parseCSV(text) {
  const sep = (text.split(/\r?\n/)[0].match(/;/g) || []).length >= (text.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== '')).map((r) => r.map((x) => x.replace(/^﻿/, '').trim()));
}

export function compressImage(file, max = 320, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Imprime HTML en un iframe oculto (no depende de ventanas emergentes)
export function printHTML(html) {
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const d = frame.contentWindow.document;
  d.open(); d.write(html); d.close();
  const go = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.warn(e); }
    setTimeout(() => frame.remove(), 2000);
  };
  if (d.readyState === 'complete') setTimeout(go, 250); else frame.onload = () => setTimeout(go, 150);
}

export function emptyState(ic, title, text = '') {
  return `<div class="empty">${icon(ic)}<b>${title}</b>${text ? `<span>${text}</span>` : ''}</div>`;
}

export function setBusy(btn, busy, text) {
  if (!btn) return;
  if (busy) { btn.dataset.txt = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>${text ? ' ' + text : ''}`; }
  else { btn.disabled = false; if (btn.dataset.txt) btn.innerHTML = btn.dataset.txt; }
}

export function waLink(phone, text) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '58' + p.slice(1);
  else if (p.length === 10) p = '58' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text)}`;
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('sr_theme', next); } catch (_) {}
  document.querySelectorAll('#sb-theme').forEach((b) => { b.innerHTML = icon(next === 'dark' ? 'sun' : 'moon'); });
  return next;
}
