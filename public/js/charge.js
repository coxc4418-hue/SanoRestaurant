// SANO Restaurant — Ventana de cobro (pagos mixtos en $ y Bs)
import { store } from './store.js';
import { chargeSale, orderTotals } from './ops.js';
import { openModal, toast, num, esc, parseNum, setBusy, usd, bs, PAY_METHODS, round2 } from './utils.js';
import { icon } from './icons.js';
import { printReceipt, notifyLowStock } from './shared.js';

const prefPrint = () => { try { return localStorage.getItem('sr_print') === '1'; } catch (_) { return false; } };
const setPrefPrint = (v) => { try { localStorage.setItem('sr_print', v ? '1' : '0'); } catch (_) {} };

/**
 * Abre el cobro.
 * ctx: { order, type, tableId, lines, customer, waiter, people, address, note, deliveryFee }
 * Resuelve con la venta registrada o null si se cancela.
 */
export function openCharge(ctx) {
  return new Promise((resolve) => {
    const rate = store.rate;
    if (!(rate > 0)) { toast('Configura la tasa del día antes de cobrar.', 'warning'); resolve(null); return; }
    if (!store.openShift) { toast('Abre la caja antes de cobrar (menú Caja).', 'warning', 4500); resolve(null); return; }
    const s = store.settings;
    const st = {
      discount: 0,
      tip: 0,
      deliveryFee: ctx.type === 'delivery' ? (ctx.deliveryFee ?? Number(s.deliveryFee) ?? 0) : 0,
      pays: [],
      changeCurrency: 'BS'
    };
    let done = false;
    const m = openModal({
      title: 'Cobrar', size: 'lg',
      sub: `${ctx.type === 'mesa' ? esc(ctx.tableName || 'Mesa') : ctx.type === 'delivery' ? 'Delivery' : 'Para llevar'}${ctx.customer?.name ? ' · ' + esc(ctx.customer.name) : ''} · Tasa Bs ${num(rate)}`,
      body: `
        <div class="stack">
          <div class="pay-total"><div class="small muted">Total a cobrar</div><b data-total>$ 0,00</b><span data-totalbs>Bs 0,00</span></div>
          <div class="${ctx.type === 'delivery' ? 'form-grid-3' : 'form-grid'}">
            <div class="field"><label>Descuento ($)</label><div class="input-group"><span class="prefix">$</span><input class="input input-sm" data-disc inputmode="decimal" placeholder="0,00"></div></div>
            <div class="field"><label>Propina (opcional)</label><div class="input-group"><span class="prefix">$</span><input class="input input-sm" data-tip inputmode="decimal" placeholder="0,00"></div></div>
            ${ctx.type === 'delivery' ? `<div class="field"><label>Delivery ($)</label><div class="input-group"><span class="prefix">$</span><input class="input input-sm" data-dfee inputmode="decimal" value="${num(st.deliveryFee)}"></div></div>` : ''}
          </div>
          <div data-breakdown class="small muted"></div>
          <div>
            <div class="section-title">Forma de pago</div>
            <div class="pay-methods mt">${Object.entries(PAY_METHODS).map(([k, p]) => `<button type="button" class="pay-method" data-m="${k}"><i style="background:${p.color}"></i>${p.label}</button>`).join('')}</div>
          </div>
          <div class="pay-lines" data-lines></div>
          <div class="pay-status due" data-status></div>
          <div class="between row-wrap" data-change-row hidden>
            <span class="bold">Dar vuelto en</span>
            <div class="seg"><button type="button" data-cc="BS">Bolívares</button><button type="button" data-cc="USD">Dólares</button></div>
          </div>
          <label class="check"><input type="checkbox" data-print ${prefPrint() ? 'checked' : ''}> <span>Imprimir recibo al cobrar</span></label>
          <div class="error-msg" data-err></div>
        </div>`,
      footer: `<button class="btn btn-secondary" data-close>Cancelar</button><button class="btn btn-success btn-lg" data-ok>${icon('check')} Cobrar</button>`,
      onClose: () => { if (!done) resolve(null); }
    });
    const $ = (q) => m.el.querySelector(q);
    const totals = () => orderTotals(ctx.lines, { discount: st.discount, deliveryFee: st.deliveryFee, tip: st.tip });
    const paidUSD = () => round2(st.pays.reduce((a, p) => a + (PAY_METHODS[p.method].cur === 'BS' ? p.amount / rate : p.amount), 0));

    function addPay(method) {
      const t = totals().total;
      const rest = Math.max(0, round2(t - paidUSD()));
      const cur = PAY_METHODS[method].cur;
      st.pays.push({ method, amount: cur === 'BS' ? round2(rest * rate) : rest });
      renderLines();
      const inputs = m.el.querySelectorAll('[data-amt]');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    }

    function renderLines() {
      $('[data-lines]').innerHTML = st.pays.map((p, i) => {
        const def = PAY_METHODS[p.method];
        const eq = def.cur === 'BS' ? usd(p.amount / rate) : bs(p.amount * rate);
        return `<div class="pay-line">
          <span class="lbl"><i style="background:${def.color}"></i>${def.label}</span>
          <div class="input-group"><span class="prefix">${def.cur === 'BS' ? 'Bs' : '$'}</span><input class="input input-sm" style="padding-left:${def.cur === 'BS' ? 34 : 26}px" data-amt="${i}" inputmode="decimal" value="${num(p.amount)}"></div>
          <span class="small muted hide-xs num" data-eq="${i}">≈ ${eq}</span>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-rm="${i}" aria-label="Quitar">${icon('x')}</button>
        </div>`;
      }).join('');
      m.el.querySelectorAll('[data-amt]').forEach((inp) => {
        inp.oninput = () => {
          const p = st.pays[+inp.dataset.amt];
          p.amount = parseNum(inp.value);
          const eqEl = m.el.querySelector(`[data-eq="${inp.dataset.amt}"]`);
          if (eqEl) eqEl.textContent = '≈ ' + (PAY_METHODS[p.method].cur === 'BS' ? usd(p.amount / rate) : bs(p.amount * rate));
          renderStatus();
        };
      });
      m.el.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { st.pays.splice(+b.dataset.rm, 1); renderLines(); });
      m.el.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', st.pays.some((p) => p.method === b.dataset.m)));
      renderStatus();
    }

    function renderStatus() {
      const t = totals();
      $('[data-total]').textContent = usd(t.total);
      $('[data-totalbs]').textContent = bs(t.total * rate);
      const parts = [`Subtotal ${usd(t.subtotal)}`];
      if (t.discount) parts.push(`Descuento −${usd(t.discount)}`);
      if (t.delivery) parts.push(`Delivery ${usd(t.delivery)}`);
      if (t.tip) parts.push(`Propina ${usd(t.tip)}`);
      $('[data-breakdown]').textContent = parts.join(' · ');
      const paid = paidUSD();
      const diff = round2(paid - t.total);
      const stEl = $('[data-status]');
      if (!st.pays.length) { stEl.className = 'pay-status due'; stEl.innerHTML = `<span>Elige una forma de pago</span><span>${usd(t.total)}</span>`; }
      else if (diff < -0.009) { stEl.className = 'pay-status due'; stEl.innerHTML = `<span>Falta</span><span class="num">${usd(-diff)} · ${bs(-diff * rate)}</span>`; }
      else { stEl.className = 'pay-status ok'; stEl.innerHTML = diff > 0.009 ? `<span>Vuelto</span><span class="num">${st.changeCurrency === 'BS' ? bs(diff * rate) : usd(diff)}</span>` : `<span>${icon('check')} Pago completo</span><span></span>`; }
      $('[data-change-row]').hidden = !(diff > 0.009);
      m.el.querySelectorAll('[data-cc]').forEach((b) => b.classList.toggle('on', b.dataset.cc === st.changeCurrency));
      $('[data-ok]').innerHTML = `${icon('check')} Cobrar ${usd(t.total)}`;
    }

    m.el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => addPay(b.dataset.m));
    m.el.querySelectorAll('[data-cc]').forEach((b) => b.onclick = () => { st.changeCurrency = b.dataset.cc; renderStatus(); });
    $('[data-disc]').oninput = (e) => { st.discount = parseNum(e.target.value); renderStatus(); };
    $('[data-tip]').oninput = (e) => { st.tip = parseNum(e.target.value); renderStatus(); };
    if ($('[data-dfee]')) $('[data-dfee]').oninput = (e) => { st.deliveryFee = parseNum(e.target.value); renderStatus(); };

    $('[data-ok]').onclick = async (e) => {
      const btn = e.currentTarget; const err = $('[data-err]');
      err.textContent = '';
      if (!st.pays.length) { err.textContent = 'Elige al menos una forma de pago.'; return; }
      setBusy(btn, true, 'Cobrando…');
      try {
        const { sale, lowAfter } = await chargeSale({
          order: ctx.order || null, type: ctx.type, tableId: ctx.tableId, lines: ctx.lines, customer: ctx.customer || null,
          discount: st.discount, deliveryFee: st.deliveryFee, tip: st.tip,
          payments: st.pays, changeCurrency: st.changeCurrency, note: ctx.note || '', waiter: ctx.waiter || '', people: ctx.people || 0, address: ctx.address || ''
        });
        const doPrint = $('[data-print]').checked;
        setPrefPrint(doPrint);
        done = true;
        m.close();
        if (doPrint) printReceipt(sale);
        notifyLowStock(lowAfter);
        showDone(sale);
        resolve(sale);
      } catch (ex) {
        err.textContent = ex?.message || String(ex);
        setBusy(btn, false);
      }
    };
    // Si el total es 0 no tiene sentido pedir pago
    renderLines();
    if (totals().total > 0) addPay('efectivo_usd');
  });
}

function showDone(sale) {
  const m = openModal({
    size: 'sm',
    body: `<div class="center stack" style="padding:18px 0 4px;align-items:center">
      <div class="kpi-icon tone-success" style="width:64px;height:64px;border-radius:20px">${icon('check')}</div>
      <div><div class="muted small">Pedido</div><div style="font-size:40px;font-weight:800;letter-spacing:-.03em">#${esc(sale.orderNo)}</div></div>
      <div><b style="font-size:20px">${usd(sale.total)}</b><div class="text-bs bold">${bs(sale.totalBs)}</div></div>
      ${sale.changeUSD > 0.009 ? `<div class="badge badge-warning" style="height:28px;font-size:13px">Vuelto: ${sale.changeCurrency === 'BS' ? bs(sale.changeUSD * sale.rate) : usd(sale.changeUSD)}</div>` : ''}
    </div>`,
    footer: `<button class="btn btn-secondary" data-pr>${icon('print')} Recibo</button><button class="btn btn-primary" data-close autofocus>Listo</button>`
  });
  m.el.querySelector('[data-pr]').onclick = () => printReceipt(sale);
}
