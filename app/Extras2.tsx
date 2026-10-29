'use client';
// Guardar como app/Extras2.tsx (al lado de page.tsx y Extras.tsx)
import { useState } from 'react';
import { S, Tx, Contacto, abierta, abonos, eliminarContacto, liquidarContacto, money, nuevoContacto, pendientesDe, saldo, saldoContacto } from '../lib/engine';

type Act = (fn: (n: S) => string | null, ok: string) => boolean;
const COL = { ok: '#3fb950', mid: '#d29922', bad: '#f85149' };
const r2 = (x: number) => Math.round(x * 100) / 100;
const fh = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const venc = (t: Tx) => !!t.due && t.due < new Date().toISOString().slice(0, 10);
const dig = (x: string) => x.replace(/\D/g, '');
const TIPO: Record<string, string> = { SALE: 'Venta', PURCHASE: 'Compra', EXPENSE: 'Gasto', COLLECTION: 'Cobro', PAYMENT: 'Pago' };
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* ═════════════════ 1. CLIENTES Y PROVEEDORES ═════════════════ */

// Selector reutilizable para la Registradora (CLI) y Compras / Gastos (PROV)
export function SelContacto({ s, tipo, value, onChange }: { s: S; tipo: 'CLI' | 'PROV'; value: number; onChange: (id: number, name: string) => void }) {
  const l = s.contactos.filter(c => c.tipo === tipo);
  return (<label>{tipo === 'CLI' ? 'Cliente registrado' : 'Proveedor registrado'}
    <select value={value} onChange={e => { const id = +e.target.value; onChange(id, l.find(c => c.id === id)?.name ?? ''); }}>
      <option value={0}>{tipo === 'CLI' ? 'Consumidor final' : '— Sin proveedor —'}</option>
      {l.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>);
}

function FormContacto({ tipo, act, onDone }: { tipo: 'CLI' | 'PROV'; act: Act; onDone: () => void }) {
  const v0 = { name: '', doc: '', tel: '', email: '', dir: '' };
  const [f, setF] = useState(v0);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const et = tipo === 'CLI' ? 'cliente' : 'proveedor';
  return (<div className="box" style={{ marginTop: 10 }}><h3>➕ Nuevo {et}</h3>
    <div className="form">
      <label>Nombre / Razón social *<input value={f.name} onChange={e => set('name', e.target.value)} /></label>
      <label>CUIT / DNI<input value={f.doc} onChange={e => set('doc', e.target.value)} placeholder="20-12345678-9" /></label>
      <label>Teléfono<input value={f.tel} onChange={e => set('tel', e.target.value)} /></label>
      <label>Email<input value={f.email} onChange={e => set('email', e.target.value)} /></label>
      <label>Dirección<input value={f.dir} onChange={e => set('dir', e.target.value)} /></label></div>
    <div className="pills">
      <button className="p" onClick={() => { if (act(n => nuevoContacto(n, tipo, f.name, f.doc, f.tel, f.email, f.dir), `${et[0].toUpperCase() + et.slice(1)} «${f.name.trim()}» creado.`)) { setF(v0); onDone(); } }}>💾 Guardar {et}</button>
      <button onClick={onDone}>Cancelar</button></div></div>);
}

// Cobro / pago a cuenta: se aplica a las deudas más antiguas primero (total o parcial)
function CobroContacto({ s, act, c, onDone }: { s: S; act: Act; c: Contacto; onDone: () => void }) {
  const ms = s.medios.filter(m => m.tipo !== 'credito').map(m => m.name);
  const [medio, setM] = useState(ms[0]); const [m, setMonto] = useState('');
  const cli = c.tipo === 'CLI', sd = saldoContacto(s, c);
  const pend = pendientesDe(s, c).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || a.id - b.id);
  const parcial = m !== '' && +m > 0 && +m < sd - 0.005;
  const vl = cli ? 'Cobrar' : 'Pagar';
  return (<div className="box" style={{ marginTop: 10 }}><h3>{cli ? '💰 Registrar cobro' : '🏦 Registrar pago'} · {c.name}</h3>
    {!abierta(s) && <p className="neg">🔒 La caja está cerrada. Abrila en Registradora → Apertura.</p>}
    {!pend.length ? <p className="mut">No hay comprobantes pendientes. 🎉</p> : (<>
      {pend.map(t => (<div className="row" key={t.id}>
        <span>#{t.id} · {t.desc.slice(0, 60)}{t.desc.length > 60 ? '…' : ''}</span>
        <span>total {money(t.amount)} · <b>saldo {money(saldo(s, t))}</b>
          {t.due && <span className={venc(t) ? 'neg' : 'mut'}> · vence {t.due.slice(5).split('-').reverse().join('/')}{venc(t) ? ' ⚠️' : ''}</span>}</span></div>))}
      <div className="form">
        <label>Medio<select value={medio} onChange={e => setM(e.target.value)}>{ms.map(x => <option key={x}>{x}</option>)}</select></label>
        <label>Monto (vacío = saldo total {money(sd)})<input type="number" min={0} value={m} onChange={e => setMonto(e.target.value)} /></label></div>
      <div className="pills">
        <button onClick={() => setMonto(String(sd))}>Todo</button>
        <button className="p" disabled={!abierta(s)} onClick={() => { if (act(n => liquidarContacto(n, c.id, medio, m === '' ? undefined : +m), `${cli ? 'Cobro' : 'Pago'}${parcial ? ' parcial' : ''} registrado a ${c.name}.`)) { setMonto(''); onDone(); } }}>
          {vl}{parcial ? ' parcial' : ''}</button>
        <button onClick={onDone}>Cerrar</button></div>
      <p className="mut">El monto se aplica primero a los comprobantes más antiguos (por vencimiento). Cada aplicación queda registrada en el Historial.</p></>)}</div>);
}

// Cuenta corriente: cargos, pagos y saldo acumulado vinculados a las operaciones de la registradora
function CuentaCorriente({ s, c, onDone }: { s: S; c: Contacto; onDone: () => void }) {
  const own = s.txs.filter(t => t.cid === c.id && !t.void);
  const ids = new Set(own.map(t => t.id));
  const pagos = s.txs.filter(t => !t.void && t.pays != null && ids.has(t.pays));
  const fiada = (t: Tx) => t.status === 'PENDING' || t.paidBy != null || abonos(s, t.id).length > 0;
  const base = [...own.map(t => ({ t, cargo: fiada(t) ? t.amount : 0, abono: 0, contado: !fiada(t) })),
    ...pagos.map(t => ({ t, cargo: 0, abono: t.amount, contado: false }))].sort((a, b) => a.t.at.localeCompare(b.t.at) || a.t.id - b.t.id);
  let acc = 0; const filas = base.map(f => { acc = r2(acc + f.cargo - f.abono); return { ...f, acc }; });
  const cli = c.tipo === 'CLI';
  return (<div className="box" style={{ marginTop: 10 }}>
    <div className="row"><h3>📒 Cuenta corriente · {c.name}</h3><button onClick={onDone}>✕ Cerrar</button></div>
    {!filas.length ? <p className="mut">Todavía no hay operaciones vinculadas. Elegí a {cli ? 'este cliente en la Registradora' : 'este proveedor en Compras o Gastos'} para que aparezcan acá.</p> : (
      <div className="scroll"><table><thead><tr><th>Fecha</th><th>#</th><th>Tipo</th><th>Detalle</th><th>{cli ? 'Nos debe (+)' : 'Le debemos (+)'}</th><th>{cli ? 'Pagó (−)' : 'Pagamos (−)'}</th><th>Saldo</th></tr></thead><tbody>
        {filas.map(({ t, cargo, abono, contado, acc: a }) => (<tr key={t.id} style={contado ? { opacity: .6 } : undefined}>
          <td>{fh(t.at)}</td><td>{t.id}</td><td>{TIPO[t.type]}{contado ? ' (contado)' : ''}</td>
          <td style={{ textAlign: 'left' }}>{t.desc.slice(0, 70)}{t.desc.length > 70 ? '…' : ''}</td>
          <td className={cargo ? 'neg' : ''}>{cargo ? money(cargo) : '–'}</td><td className={abono ? 'pos' : ''}>{abono ? money(abono) : '–'}</td>
          <td><b className={contado ? '' : a > 0.005 ? 'neg' : 'pos'}>{contado ? '–' : money(a)}</b></td></tr>))}</tbody></table></div>)}
    <div className="row"><span>Saldo actual</span><strong style={{ fontSize: 22, color: saldoContacto(s, c) > 0.005 ? COL.bad : COL.ok }}>{money(saldoContacto(s, c))}</strong></div></div>);
}

export function Contactos({ s, act }: { s: S; act: Act }) {
  const [vista, setVista] = useState<'CLI' | 'PROV'>('CLI');
  const [q, setQ] = useState(''); const [fil, setFil] = useState<'all' | 'deu' | 'ok'>('all');
  const [nuevo, setNuevo] = useState(false); const [conf, setConf] = useState<number | null>(null);
  const [open, setOpen] = useState<{ id: number; modo: 'cobro' | 'cc' } | null>(null);
  const cli = vista === 'CLI';
  const kq = q.trim().toLowerCase(), kd = dig(q);
  const todos = s.contactos.filter(c => c.tipo === vista).map(c => ({ c, sd: saldoContacto(s, c) }));
  const lista = todos.filter(({ c, sd }) =>
    (fil === 'all' || (fil === 'deu' ? sd > 0.005 : sd <= 0.005)) &&
    (!kq || c.name.toLowerCase().includes(kq) || c.doc.toLowerCase().includes(kq) || c.tel.toLowerCase().includes(kq) || (kd !== '' && (dig(c.doc).includes(kd) || dig(c.tel).includes(kd)))));
  const totalSaldo = todos.reduce((a, x) => a + x.sd, 0), deudores = todos.filter(x => x.sd > 0.005).length;
  const nVenc = (c: Contacto) => pendientesDe(s, c).filter(venc).length;
  const filtros: [typeof fil, string][] = [['all', `Todos (${todos.length})`], ['deu', `Con saldo deudor (${deudores})`], ['ok', `Al día (${todos.length - deudores})`]];
  return (<div className="box"><h3>👥 Clientes y Proveedores</h3>
    <div className="pills">
      <button className={cli ? 'on' : ''} onClick={() => { setVista('CLI'); setOpen(null); setNuevo(false); }}>🧑 Clientes ({s.contactos.filter(c => c.tipo === 'CLI').length})</button>
      <button className={!cli ? 'on' : ''} onClick={() => { setVista('PROV'); setOpen(null); setNuevo(false); }}>🚚 Proveedores ({s.contactos.filter(c => c.tipo === 'PROV').length})</button></div>
    <div className="kpis">
      <div className="kpi"><small>{cli ? 'Total que nos deben' : 'Total que debemos'}</small><strong className={totalSaldo > 0.005 ? 'neg' : 'pos'}>{money(totalSaldo)}</strong></div>
      <div className="kpi"><small>{cli ? 'Clientes con deuda' : 'Proveedores con deuda'}</small><strong>{deudores}</strong></div></div>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, CUIT/DNI o teléfono" />
    <div className="pills">{filtros.map(([k, l]) => <button key={k} className={fil === k ? 'on' : ''} onClick={() => setFil(k)}>{l}</button>)}
      <button className="p" onClick={() => setNuevo(!nuevo)}>{nuevo ? '✖ Cancelar' : `➕ Nuevo ${cli ? 'cliente' : 'proveedor'}`}</button></div>
    {nuevo && <FormContacto key={vista} tipo={vista} act={act} onDone={() => setNuevo(false)} />}
    {!lista.length && <p className="mut">{todos.length ? 'Ningún contacto coincide con la búsqueda o el filtro.' : `Todavía no cargaste ${cli ? 'clientes' : 'proveedores'}.`}</p>}
    {lista.map(({ c, sd }) => { const deu = sd > 0.005, nv = nVenc(c); return (
      <div className="box" key={c.id} style={{ marginTop: 10, borderLeft: `4px solid ${deu ? COL.bad : COL.ok}` }}>
        <div className="row"><h3>{c.name}</h3><strong style={{ fontSize: 24, color: deu ? COL.bad : COL.ok }}>{money(sd)}</strong></div>
        <p className="mut">🪪 {c.doc || 's/d'} · 📞 {c.tel || 's/d'}{c.email ? ` · ✉️ ${c.email}` : ''}{c.dir ? ` · 📍 ${c.dir}` : ''}</p>
        <p style={{ color: deu ? COL.bad : COL.ok }}><b>{deu ? `🔴 ${cli ? 'Nos debe' : 'Le debemos'}${nv ? ` · ${nv} vencida(s) ⚠️` : ''}` : '🟢 Al día'}</b></p>
        <div className="pills">
          <button className="p" disabled={!deu} onClick={() => setOpen(open?.id === c.id && open.modo === 'cobro' ? null : { id: c.id, modo: 'cobro' })}>{cli ? '💰 Cobrar' : '🏦 Pagar'}</button>
          <button onClick={() => setOpen(open?.id === c.id && open.modo === 'cc' ? null : { id: c.id, modo: 'cc' })}>📒 Cuenta corriente</button>
          {conf === c.id
            ? <span><span className="neg">¿Eliminar a {c.name}? </span><button className="p" onClick={() => { act(n => eliminarContacto(n, c.id), `«${c.name}» eliminado.`); setConf(null); }}>Sí</button> <button onClick={() => setConf(null)}>No</button></span>
            : <button onClick={() => setConf(c.id)}>Eliminar</button>}</div>
        {open?.id === c.id && open.modo === 'cobro' && <CobroContacto s={s} act={act} c={c} onDone={() => setOpen(null)} />}
        {open?.id === c.id && open.modo === 'cc' && <CuentaCorriente s={s} c={c} onDone={() => setOpen(null)} />}</div>); })}</div>);
}

/* ═════════════════ 2. TICKET / COMPROBANTE ═════════════════ */
const esc = (x: string) => x.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

// Abre el diálogo de impresión del navegador (ahí mismo se puede elegir «Guardar como PDF»)
export function imprimirTicket(s: S, t: Tx, cae = '', caeVto = '') {
  const n = s.neg;
  const bruto = r2(t.items.reduce((a, i) => a + i.qty * i.price, 0));
  const cli = s.contactos.find(c => c.id === t.cid);
  const canal = t.plat ? `Plataforma: ${esc(t.plat)}` : t.pas ? `Pasarela: ${esc(t.pas)}${t.cuotas ? ` (${t.cuotas} cuotas)` : ''}` : 'Local físico';
  const pagos = t.split
    ? t.split.map(p => `<div class="f"><span>${esc(p.medio)}</span><span>${money(p.monto)}</span></div>`).join('')
    : `<div class="f"><span>${esc(t.medio)}</span><span>${money(t.amount)}</span></div>`;
  const sd = t.status === 'PENDING' ? saldo(s, t) : 0;
  const filas = t.items.map(i => `<tr><td>${i.qty} x</td><td>${esc(i.name)}<br><small>${money(i.price)} c/u</small></td><td class="r">${money(i.qty * i.price)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ticket #${t.id}</title><style>
@page{size:80mm auto;margin:3mm}*{box-sizing:border-box}
body{font:12px/1.35 'Courier New',monospace;width:74mm;margin:0 auto;color:#000}
h1{font-size:15px;text-align:center;margin:0 0 2px}.c{text-align:center}.f{display:flex;justify-content:space-between;gap:8px}
table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:2px 0}.r{text-align:right}
hr{border:0;border-top:1px dashed #000;margin:6px 0}.t{font-size:15px;font-weight:bold}small{font-size:10px}</style></head><body>
<h1>${esc(n.nombre || 'Comprobante de venta')}</h1>
<div class="c">${n.cuit ? `CUIT: ${esc(n.cuit)}<br>` : ''}${n.dir ? `${esc(n.dir)}<br>` : ''}${n.tel ? `Tel: ${esc(n.tel)}<br>` : ''}${n.email ? `${esc(n.email)}<br>` : ''}</div>
<hr><div class="f"><span>Ticket Nº ${String(t.id).padStart(6, '0')}</span><span>${new Date(t.at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
<div>Cliente: ${cli ? esc(cli.name) + (cli.doc ? ` (${esc(cli.doc)})` : '') : 'Consumidor final'}</div><div>Canal: ${canal}</div>
<hr><table>${filas}</table><hr>
<div class="f"><span>Subtotal</span><span>${money(bruto)}</span></div>
${t.disc ? `<div class="f"><span>Descuento</span><span>-${money(t.disc)}</span></div>` : ''}
${t.rec ? `<div class="f"><span>Recargo medio de pago</span><span>${money(t.rec)}</span></div>` : ''}
${t.iva ? `<div class="f"><span>IVA incluido</span><span>${money(t.iva)}</span></div>` : ''}
<div class="f t"><span>TOTAL</span><span>${money(t.amount)}</span></div>
<hr><div>Medio de pago:</div>${pagos}
${sd > 0 ? `<div class="f"><b>Saldo pendiente (cta. cte.)</b><b>${money(sd)}</b></div>` : ''}
<hr>${cae ? `<div class="c">CAE: ${esc(cae)}${caeVto ? `<br>Vto. CAE: ${esc(caeVto)}` : ''}</div>` : '<div class="c">Comprobante no válido como factura</div>'}
<div class="c">¡Gracias por su compra!</div></body></html>`;
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(fr);
  const d = fr.contentDocument!; d.open(); d.write(html); d.close();
  setTimeout(() => { fr.contentWindow?.focus(); fr.contentWindow?.print(); setTimeout(() => fr.remove(), 3000); }, 300);
}

// Panel que aparece en la Registradora después de cobrar
export function UltimaVenta({ s, id, onClose }: { s: S; id: number; onClose: () => void }) {
  const [cae, setCae] = useState(''); const [vto, setVto] = useState('');
  const t = s.txs.find(x => x.id === id && x.type === 'SALE');
  if (!t) return null;
  return (<div className="box" style={{ borderColor: COL.ok, marginBottom: 10 }}>
    <div className="row"><b>✅ Venta #{t.id} registrada · {money(t.amount)}</b><button onClick={onClose}>✕</button></div>
    {!s.neg.nombre.trim() && <p className="mut">Tip: cargá los datos del negocio en Configuración para que salgan en el ticket.</p>}
    <div className="form">
      <label>CAE (opcional)<input value={cae} onChange={e => setCae(e.target.value)} placeholder="Solo si facturaste en ARCA" /></label>
      <label>Vto. CAE (opcional)<input value={vto} onChange={e => setVto(e.target.value)} placeholder="dd/mm/aaaa" /></label></div>
    <div className="pills"><button className="p" onClick={() => imprimirTicket(s, t, cae.trim(), vto.trim())}>🖨️ Imprimir ticket / PDF</button></div>
    <p className="mut">En el diálogo de impresión elegí «Guardar como PDF» si querés el archivo. Sin CAE, el ticket dice «Comprobante no válido como factura».</p></div>);
}

/* ═════════════════ 3. PUNTO DE EQUILIBRIO ═════════════════ */
function GraficoPE({ cf, cmPct, be, rev, proy }: { cf: number; cmPct: number; be: number; rev: number; proy: number }) {
  const W = 640, H = 250, L = 64, R = 12, T = 12, B = 26;
  const xmax = Math.max(be * 1.7, rev * 1.15, proy * 1.1, 1);
  const ct = (x: number) => cf + (1 - cmPct) * x;
  const ymax = Math.max(xmax, ct(xmax));
  const X = (x: number) => L + x / xmax * (W - L - R), Y = (y: number) => H - B - y / ymax * (H - B - T);
  const ok = rev >= be;
  return (<svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 280 }}>
    <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="#30363d" /><line x1={L} x2={L} y1={T} y2={Y(0)} stroke="#30363d" />
    <line x1={X(0)} x2={X(xmax)} y1={Y(cf)} y2={Y(cf)} stroke="#8b949e" strokeDasharray="4 4" />
    <line x1={X(0)} y1={Y(0)} x2={X(xmax)} y2={Y(xmax)} stroke={COL.ok} strokeWidth={2} />
    <line x1={X(0)} y1={Y(cf)} x2={X(xmax)} y2={Y(ct(xmax))} stroke={COL.bad} strokeWidth={2} />
    <line x1={X(rev)} x2={X(rev)} y1={T} y2={Y(0)} stroke={ok ? COL.ok : COL.mid} strokeDasharray="3 3" />
    <circle cx={X(be)} cy={Y(be)} r={5} fill="#58a6ff" />
    <text x={X(be)} y={Y(be) - 10} textAnchor="middle" fontSize={11} fill="#58a6ff">Equilibrio {money(be)}</text>
    <text x={X(rev)} y={T + 10} textAnchor={X(rev) > W * 0.7 ? 'end' : 'start'} fontSize={10} fill={ok ? COL.ok : COL.mid}> Ventas a la fecha</text>
    <text x={L - 4} y={Y(0)} textAnchor="end" fontSize={10} fill="#8b949e">$0</text>
    <text x={L - 4} y={T + 8} textAnchor="end" fontSize={10} fill="#8b949e">{money(ymax)}</text>
    <text x={W - R} y={H - 8} textAnchor="end" fontSize={10} fill="#8b949e">Ventas netas → {money(xmax)}</text>
    <text x={L + 4} y={Y(cf) - 4} fontSize={10} fill="#8b949e">Costos fijos</text></svg>);
}

export function PuntoEquilibrio({ s }: { s: S }) {
  const hoy = new Date(), y = hoy.getFullYear();
  const [m, setM] = useState(hoy.getMonth()); const [extra, setExtra] = useState(0); const [excl, setExcl] = useState<number[]>([]);
  const enMes = (iso: string) => { const d = new Date(iso); return d.getFullYear() === y && d.getMonth() === m; };

  // Costos fijos del período: gastos operativos registrados (sin IVA) + extras manuales
  const gastos = s.txs.filter(t => !t.void && t.type === 'EXPENSE' && enMes(t.at));
  const cfReg = gastos.filter(t => !excl.includes(t.id)).reduce((a, t) => a + t.amount - (t.iva ?? 0), 0);
  const cf = r2(cfReg + Math.max(0, extra));

  // Contribución por producto (ventas netas sin IVA ni recargo − costo − comisión absorbida)
  const mapa = new Map<number, { name: string; u: number; rev: number; cost: number; com: number }>();
  for (const t of s.txs) {
    if (t.void || t.type !== 'SALE' || !enMes(t.at)) continue;
    const bruto = t.items.reduce((a, i) => a + i.qty * i.price, 0); if (bruto <= 0) continue;
    const R = t.amount - (t.iva ?? 0) - (t.rec ?? 0);
    for (const i of t.items) {
      const sh = i.qty * i.price / bruto, o = mapa.get(i.pid) ?? { name: i.name, u: 0, rev: 0, cost: 0, com: 0 };
      o.u += i.qty; o.rev += R * sh; o.cost += i.qty * i.cost; o.com += (t.comAbs ?? 0) * sh; mapa.set(i.pid, o);
    }
  }
  const filas = [...mapa.values()].sort((a, b) => b.rev - a.rev);
  const rev = filas.reduce((a, f) => a + f.rev, 0), uni = filas.reduce((a, f) => a + f.u, 0);
  const cm = filas.reduce((a, f) => a + f.rev - f.cost - f.com, 0);
  const cat = s.prods.filter(p => p.price > 0);
  const catPct = cat.length ? cat.reduce((a, p) => a + (p.price - p.cost) / p.price, 0) / cat.length : 0;
  const catU = cat.length ? cat.reduce((a, p) => a + p.price - p.cost, 0) / cat.length : 0;
  const usaCat = rev <= 0;
  const cmPct = usaCat ? catPct : cm / rev, cmU = usaCat ? catU : uni > 0 ? cm / uni : 0;

  const be = cmPct > 0 ? cf / cmPct : null, beU = cmU > 0 ? cf / cmU : null;
  const esMesActual = m === hoy.getMonth();
  const dia = hoy.getDate(), dim = new Date(y, m + 1, 0).getDate();
  const proy = esMesActual ? rev / dia * dim : rev;
  const pct = (v: number) => be && be > 0 ? v / be * 100 : 0;
  const colP = (p: number) => (p >= 100 ? COL.ok : p >= 70 ? COL.mid : COL.bad);
  const resultado = cm - cf;

  const Barra = ({ l, v }: { l: string; v: number }) => { const p = pct(v);
    return (<div style={{ margin: '8px 0' }}><div className="row"><span>{l}</span><b style={{ color: colP(p) }}>{money(v)} · {Math.round(p)}% del equilibrio</b></div>
      <div style={{ position: 'relative', background: '#21262d', borderRadius: 8, height: 18, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(p / 150 * 100, 100)}%`, height: '100%', background: colP(p) }} />
        <div style={{ position: 'absolute', left: '66.67%', top: 0, bottom: 0, width: 2, background: '#e6edf3' }} /></div></div>); };

  return (<div className="box"><h3>⚖️ Punto de equilibrio</h3>
    <p className="mut">Cuánto tenés que vender para que el resultado del mes sea exactamente cero: cubrís todos los costos fijos y no ganás ni perdés.</p>
    <div className="form">
      <label>Período<select value={m} onChange={e => { setM(+e.target.value); setExcl([]); }}>{MESES.map((n, i) => <option key={i} value={i}>{n} {y}</option>)}</select></label>
      <label>Otros costos fijos no cargados $ (opcional)<input type="number" min={0} value={extra} onChange={e => setExtra(+e.target.value)} placeholder="Ej: sueldos, cuota de un préstamo" /></label></div>

    <div className="kpis">
      <div className="kpi"><small>Costos fijos del período</small><strong>{money(cf)}</strong></div>
      <div className="kpi"><small>Margen de contribución ponderado</small><strong>{(cmPct * 100).toFixed(1)}%</strong></div>
      <div className="kpi"><small>Facturación de equilibrio</small><strong>{be == null ? 'n/d' : money(be)}</strong></div>
      <div className="kpi"><small>Unidades de equilibrio</small><strong>{beU == null ? 'n/d' : Math.ceil(beU).toLocaleString('es-AR')}</strong></div></div>
    {usaCat && <div style={{ border: '1px solid #d29922', background: 'rgba(210,153,34,.12)', borderRadius: 8, padding: '6px 10px', margin: '8px 0', color: '#e3b341' }}>ℹ️ No hay ventas en {MESES[m]}: el margen se estimó con el promedio simple del catálogo (precio vs. costo).</div>}
    {be == null ? <p className="neg">El margen de contribución es 0 o negativo: cada venta pierde plata y no existe punto de equilibrio. Revisá precios y costos.</p> : cf <= 0 ? <p className="pos">No hay costos fijos cargados en este período: cualquier venta con margen positivo ya genera ganancia.</p> : (<>
      <h3 style={{ marginTop: 14 }}>Ritmo de ventas vs. equilibrio</h3>
      <Barra l="Ventas netas a la fecha" v={rev} />
      {esMesActual && <Barra l={`Proyección a fin de mes (día ${dia} de ${dim})`} v={proy} />}
      <p style={{ color: rev >= be ? COL.ok : COL.bad }}><b>{rev >= be
        ? `✅ Estás ${money(rev - be)} por encima del equilibrio: resultado a la fecha ${money(resultado)}.`
        : `🔴 Estás ${money(be - rev)} por debajo del equilibrio${beU != null ? ` (≈ ${Math.max(0, Math.ceil(beU - uni)).toLocaleString('es-AR')} unidades más)` : ''}. Resultado a la fecha ${money(resultado)}.`}</b></p>
      {esMesActual && rev < be && <p className="mut">Para llegar necesitás vender ≈ {money((be - rev) / Math.max(1, dim - dia + 1))} netos por día en lo que queda del mes. {proy >= be ? '✅ Con el ritmo actual lo alcanzás.' : '⚠️ Con el ritmo actual no lo alcanzás.'}</p>}
      <GraficoPE cf={cf} cmPct={cmPct} be={be} rev={rev} proy={proy} />
      <p className="mut">Verde: ventas · Rojo: costos totales (fijos + variables) · Punteado gris: costos fijos · Punto azul: equilibrio, donde se cruzan ventas y costos.</p></>)}

    <h3 style={{ marginTop: 18 }}>Desglose de costos fijos · {MESES[m]}</h3>
    {!gastos.length ? <p className="mut">No hay gastos registrados en este período (Registradora → Gasto).</p> : (
      <div className="scroll"><table><thead><tr><th>Incluir</th><th>#</th><th>Fecha</th><th>Detalle</th><th>Monto sin IVA</th></tr></thead><tbody>
        {gastos.map(t => (<tr key={t.id} style={excl.includes(t.id) ? { opacity: .45 } : undefined}>
          <td><input type="checkbox" style={{ width: 'auto' }} checked={!excl.includes(t.id)} onChange={e => setExcl(e.target.checked ? excl.filter(x => x !== t.id) : [...excl, t.id])} /></td>
          <td>{t.id}</td><td>{fh(t.at)}</td><td style={{ textAlign: 'left' }}>{t.desc.slice(0, 80)}</td><td>{money(t.amount - (t.iva ?? 0))}</td></tr>))}
        {extra > 0 && <tr><td></td><td></td><td></td><td style={{ textAlign: 'left' }}>Otros costos fijos manuales</td><td>{money(extra)}</td></tr>}
        <tr className="s"><td></td><td></td><td></td><td style={{ textAlign: 'left' }}><b>Total costos fijos</b></td><td><b>{money(cf)}</b></td></tr></tbody></table></div>)}
    <p className="mut">Se toman los gastos operativos del período (alquiler, servicios, sueldos…). Destildá los que sean únicos o no recurrentes.</p>

    <h3 style={{ marginTop: 18 }}>Margen de contribución por producto · {MESES[m]}</h3>
    {!filas.length ? <p className="mut">Sin ventas en el período.</p> : (
      <div className="scroll"><table><thead><tr><th>Producto</th><th>Unid.</th><th>Ventas netas</th><th>Costo + comisión</th><th>Contribución</th><th>Margen</th><th>Mix</th></tr></thead><tbody>
        {filas.map(f => { const c = f.rev - f.cost - f.com, p = f.rev > 0 ? c / f.rev * 100 : 0; return (<tr key={f.name}>
          <td>{f.name}</td><td>{f.u}</td><td>{money(f.rev)}</td><td>{money(f.cost + f.com)}</td><td className={c < 0 ? 'neg' : ''}>{money(c)}</td>
          <td style={{ color: p >= 30 ? COL.ok : p >= 15 ? COL.mid : COL.bad }}>{p.toFixed(1)}%</td><td>{rev > 0 ? (f.rev / rev * 100).toFixed(0) : 0}%</td></tr>); })}
        <tr className="s"><td><b>Total / ponderado</b></td><td>{uni}</td><td>{money(rev)}</td><td>{money(rev - cm)}</td><td><b>{money(cm)}</b></td><td><b>{(cmPct * 100).toFixed(1)}%</b></td><td>100%</td></tr></tbody></table></div>)}
    <p className="mut">Fórmula: equilibrio = costos fijos ÷ margen de contribución. El margen es ponderado por lo que realmente vendiste (mix de productos), sin IVA ni recargos de medios de pago; descuenta el costo de ventas y las comisiones de plataforma/pasarela que absorbe el comercio. Criterio devengado, igual que el Estado de resultados.</p></div>);
}
