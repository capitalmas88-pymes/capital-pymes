'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { CUOTAS, Cfg, GLn, Insumo, Ln, Medio, Pago, Prod, REDONDEOS, RLn, S, Sel, St, Tx, abierta, anular, calcInverso, calcIva, calcPrecio, cambiarCostoInsumo, compra, costoReceta, eliminarReceta, fabricar, flows, gasto, impactoCosto, ivaRes, liquidar, money, nuevaReceta, nuevoInsumo, nuevoProd, por, pyl, recargoMedio, saldo, saldos, seed, selDefault, stk, venta } from '../lib/engine';
import { Apertura, Cierre, Combos, EstadoCaja, Movs } from './Extras';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const CATS = ['Alquiler', 'Sueldos', 'Servicios', 'Impuestos', 'Marketing', 'Mantenimiento', 'Otros'];
const SECC = { A: '⚡ Registradora exprés', B: '📦 Inventario y costos', F: '📋 Recetas y fabricación', C: '🧾 Historial', D: '📊 Estados financieros', E: '⚙️ Configuración' } as const;
type Act = (fn: (n: S) => string | null, ok: string) => boolean;
type Msg = { k: 'ok' | 'err'; t: string } | null;
const fecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const venc = (t: Tx) => !!t.due && t.due < new Date().toISOString().slice(0, 10);
const r2 = (x: number) => Math.round(x * 100) / 100;

/* ───────── Semáforo de rentabilidad ───────── */
const COL = { ok: '#3fb950', mid: '#d29922', bad: '#f85149' };
const semaf = (m: number, c: Cfg) => (m >= c.mgOk ? COL.ok : m >= c.mgBajo ? COL.mid : COL.bad);
const ico = (m: number, c: Cfg) => (m >= c.mgOk ? '🟢' : m >= c.mgBajo ? '🟡' : '🔴');
function Margen({ m, c }: { m: number; c: Cfg }) {
  return <b style={{ color: semaf(m, c) }}>{ico(m, c)} {Math.round(m * 10) / 10}%</b>;
}
const Leyenda = ({ c }: { c: Cfg }) => (
  <p className="mut">🟢 saludable (≥ {c.mgOk}%) · 🟡 ajustado (≥ {c.mgBajo}%) · 🔴 en riesgo (menos de {c.mgBajo}%). Los umbrales se cambian en Configuración.</p>);

function usePago(s: S, credito = true) {
  const ms = s.medios.filter(m => credito || m.tipo !== 'credito').map(m => m.name);
  const [medio, setM] = useState(ms[0]);
  const [estado, setE] = useState<St>('PAID');
  const [vence, setV] = useState(() => new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10));
  const ui: ReactNode = (<>
    <label>Medio de pago<select value={medio} onChange={e => setM(e.target.value)}>{ms.map(m => <option key={m}>{m}</option>)}</select></label>
    <label>Estado<select value={estado} onChange={e => setE(e.target.value as St)}><option value="PAID">Pagado</option><option value="PENDING">Pendiente</option></select></label>
    {estado === 'PENDING' && <label>Vence<input type="date" value={vence} onChange={e => setV(e.target.value)} /></label>}
  </>);
  return { medio, estado, vence, ui };
}

const IVAS = [0, 10.5, 21, 27];
function useIva() {
  const [pct, setP] = useState(0); const [inc, setI] = useState(false);
  const ui: ReactNode = (<>
    <label>IVA<select value={pct} onChange={e => setP(+e.target.value)}>{IVAS.map(v => <option key={v} value={v}>{v ? `${v}%` : 'Sin IVA'}</option>)}</select></label>
    {pct > 0 && <label>El importe…<select value={inc ? '1' : '0'} onChange={e => setI(e.target.value === '1')}>
      <option value="0">No incluye IVA</option><option value="1">Ya incluye IVA</option></select></label>}
  </>);
  return { pct, inc, ui };
}

const chkSt = { flexDirection: 'row', alignItems: 'center', gap: 6, color: '#e6edf3' } as const;
const warnSt = { border: '1px solid #d29922', background: 'rgba(210,153,34,.12)', borderRadius: 8, padding: '6px 10px', margin: '8px 0', color: '#e3b341' } as const;

/* ───────── Registradora exprés ───────── */
function Venta({ s, act }: { s: S; act: Act }) {
  const [cart, setCart] = useState<Record<number, number>>({});
  const [q, setQ] = useState(''); const [nota, setNota] = useState(''); const [pct, setPct] = useState(0);
  const [mixto, setMixto] = useState(false); const [parts, setParts] = useState<Pago[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const busq = useRef<HTMLInputElement>(null);
  const pg = usePago(s); const iv = useIva();
  const reales = s.medios.filter(m => m.tipo !== 'credito').map(m => m.name);
  const bloquea = (p: Prod) => s.cfg.bloqueaMin && stk(s, p) < p.min;

  const add = (id: number, n: number) => {
    const p = s.prods.find(x => x.id === id)!; const c = (cart[id] || 0) + n;
    if (n > 0 && (c > stk(s, p) || bloquea(p))) return;
    const nc = { ...cart }; if (c <= 0) delete nc[id]; else nc[id] = c; setCart(nc);
  };
  const bruto = Object.entries(cart).reduce((a, [id, n]) => a + n * (s.prods.find(p => p.id === +id)?.price ?? 0), 0);
  const disc = Math.round(bruto * Math.min(Math.max(pct, 0), 100)) / 100;
  const { total, iva: ivaM } = calcIva(bruto - disc, iv.pct, iv.inc);
  const rec = mixto ? r2(parts.reduce((a, p) => a + recargoMedio(s, p.medio, p.monto), 0)) : recargoMedio(s, pg.medio, total);
  const sumParts = r2(parts.reduce((a, p) => a + p.monto, 0));
  const dif = r2(total - sumParts);
  const mixtoOk = !mixto || (parts.length >= 2 && Math.abs(dif) < 0.01 && parts.every(p => p.monto > 0));
  const lista = s.prods.filter(p => p.name.toLowerCase().includes(q.toLowerCase()));
  const hayItems = Object.keys(cart).length > 0;
  const bajosEnTicket = Object.keys(cart).map(id => s.prods.find(p => p.id === +id)!).filter(p => stk(s, p) < p.min);

  const activarMixto = (v: boolean) => {
    setMixto(v);
    if (v) { const a = r2(total / 2); setParts([{ medio: reales[0], monto: a }, { medio: reales[1] ?? reales[0], monto: r2(total - a) }]); }
  };
  const setPart = (i: number, patch: Partial<Pago>) => {
    const n = parts.map((x, k) => (k === i ? { ...x, ...patch } : x));
    if (n.length === 2 && i === 0 && patch.monto !== undefined) n[1] = { ...n[1], monto: Math.max(0, r2(total - n[0].monto)) };
    setParts(n);
  };

  const confirmar = () => {
    if (!hayItems || !mixtoOk) { setCobrando(false); return; }
    const ok = act(n => venta(n, cart, pg.medio, pg.estado, pg.vence, nota.trim(), pct, undefined, iv.pct, iv.inc, mixto ? parts : undefined),
      `Venta registrada por ${money(total + rec)}.`);
    if (ok) { setCart({}); setNota(''); setPct(0); setMixto(false); setParts([]); }
    setCobrando(false);
  };

  // Atajos: F1 cobrar · Enter confirmar · Esc cancelar · F2 buscar
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); if (hayItems) setCobrando(true); }
      else if (e.key === 'F2') { e.preventDefault(); busq.current?.focus(); }
      else if (e.key === 'Escape') setCobrando(false);
      else if (e.key === 'Enter' && cobrando) { e.preventDefault(); confirmar(); }
    };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });

  return (<div className="grid">
    <div>
      <label>Buscar producto (F2) · Enter agrega si hay uno solo
        <input ref={busq} value={q} onChange={e => setQ(e.target.value)} placeholder="Escribí un nombre"
          onKeyDown={e => { if (e.key === 'Enter' && !cobrando && lista.length === 1) { add(lista[0].id, 1); setQ(''); } }} /></label>
      <div className="pills">{lista.map(p => {
        const st = stk(s, p), bajo = st < p.min, bl = bloquea(p);
        return (<button key={p.id} disabled={st <= (cart[p.id] || 0) || bl} onClick={() => add(p.id, 1)}
          title={st === 0 ? 'Sin stock' : bajo ? `Stock bajo el mínimo (${p.min})` : ''}
          style={bajo ? { borderColor: st === 0 ? COL.bad : COL.mid } : undefined}>
          {p.combo ? '🎁 ' : ''}{bajo ? '⚠️ ' : ''}{p.name} · {money(p.price)}
          {st === 0 ? ' · SIN STOCK' : bl ? ' · bloqueado' : bajo ? ` · quedan ${st}` : ''}</button>);
      })}</div>
      <p className="mut">⚠️ = bajo el stock mínimo{s.cfg.bloqueaMin ? ' (la configuración bloquea su venta)' : ' (se puede vender, pero con aviso)'}.</p>
    </div>
    <div>
      <h3>Ticket actual</h3>
      {!hayItems && <p className="mut">Tocá un producto para agregarlo.</p>}
      {Object.entries(cart).map(([id, n]) => { const p = s.prods.find(x => x.id === +id)!; const bajo = stk(s, p) < p.min; return (
        <div className="row" key={id}><span><b>{n}×</b> {p.name}{bajo && <span style={{ color: COL.mid }}> ⚠️ stock crítico</span>}</span>
          <span>{money(n * p.price)} <button onClick={() => add(+id, -1)}>−</button> <button onClick={() => add(+id, 1)}>+</button></span></div>); })}
      {!!bajosEnTicket.length && <div style={warnSt}>⚠️ Ojo: {bajosEnTicket.map(p => `${p.name} (hay ${stk(s, p)}, mínimo ${p.min})`).join(' · ')}. Reponé stock pronto.</div>}
      {ivaM > 0 && <div className="row"><span className="mut">IVA incluido en el total</span><span>{money(ivaM)}</span></div>}
      {rec > 0 && <div className="row"><span className="mut">Recargo por medio de pago (lo paga el cliente)</span><span>{money(rec)}</span></div>}
      <div className="row"><span className="mut">Total a cobrar</span><strong style={{ fontSize: 24 }}>{money(total + rec)}</strong></div>

      <div className="form">
        {!mixto && pg.ui}{iv.ui}
        <label>Cliente / nota<input value={nota} onChange={e => setNota(e.target.value)} /></label>
        <label>Descuento %<input type="number" min={0} max={100} value={pct} onChange={e => setPct(+e.target.value)} /></label></div>

      <label style={{ ...chkSt, margin: '8px 0' }}><input type="checkbox" style={{ width: 'auto' }} checked={mixto} onChange={e => activarMixto(e.target.checked)} />💳 Pago mixto (combinar medios)</label>
      {mixto && (<div className="box" style={{ marginBottom: 8 }}>
        {parts.map((p, i) => (<div className="form" key={i}>
          <label>Medio<select value={p.medio} onChange={e => setPart(i, { medio: e.target.value })}>{reales.map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Monto<input type="number" min={0} value={p.monto} onChange={e => setPart(i, { monto: +e.target.value })} /></label>
          {parts.length > 2 && <div style={{ alignSelf: 'end' }}><button onClick={() => setParts(parts.filter((_, k) => k !== i))}>✕</button></div>}</div>))}
        <div className="pills">
          <button onClick={() => { const a = r2(total / 2); setParts([{ medio: parts[0]?.medio ?? reales[0], monto: a }, { medio: parts[1]?.medio ?? reales[1] ?? reales[0], monto: r2(total - a) }]); }}>½ + ½</button>
          <button onClick={() => setParts([...parts, { medio: reales[0], monto: Math.max(0, dif) }])}>➕ Otro medio</button></div>
        <p className={Math.abs(dif) < 0.01 ? 'pos' : 'neg'}>{Math.abs(dif) < 0.01 ? '✅ Los pagos cubren el total.' : dif > 0 ? `Faltan ${money(dif)} para completar ${money(total)}.` : `Sobran ${money(-dif)} sobre ${money(total)}.`}</p>
        {rec > 0 && <p className="mut">Se suma el recargo de cada medio según su comisión.</p>}
      </div>)}

      {!cobrando
        ? <button className="p" disabled={!hayItems || !mixtoOk} onClick={() => setCobrando(true)}>Cobrar (F1)</button>
        : (<div className="box"><b>¿Confirmar cobro de {money(total + rec)}?</b>
          <div className="pills"><button className="p" onClick={confirmar}>✅ Confirmar (Enter)</button><button onClick={() => setCobrando(false)}>Cancelar (Esc)</button></div></div>)}
      <p className="mut">Atajos: <b>F1</b> cobrar · <b>Enter</b> confirmar · <b>Esc</b> cancelar · <b>F2</b> buscar.</p>
    </div></div>);
}

function Totales({ sub, pct, inc }: { sub: number; pct: number; inc: boolean }) {
  const { total, iva } = calcIva(sub, pct, inc);
  return (<>
    <div className="row"><span className="mut">Subtotal</span><span>{money(sub)}</span></div>
    {iva > 0 && <div className="row"><span className="mut">IVA {pct}%{inc ? ' (incluido)' : ''}</span><span>{money(iva)}</span></div>}
    <div className="row"><span className="mut">Total</span><strong style={{ fontSize: 24 }}>{money(total)}</strong></div></>);
}

function Compra({ s, act }: { s: S; act: Act }) {
  const comprables = s.prods.filter(p => !p.combo);
  const [lines, setLines] = useState<Ln[]>([]); const [prov, setProv] = useState('');
  const [esIns, setEs] = useState(false);
  const lista: (Prod | Insumo)[] = esIns ? s.insumos : comprables;
  const [pid0, setPid] = useState(0); const [qty, setQty] = useState(1); const [costo, setCosto] = useState(0);
  const pid = lista.some(p => p.id === pid0) ? pid0 : lista[0]?.id ?? 0;
  const [nuevo, setNuevo] = useState(false); const [nn, setNn] = useState(''); const [np, setNp] = useState(0); const [nu, setNu] = useState('kg');
  const cambiar = (v: boolean) => { setEs(v); setPid(0); setNuevo(false); };
  const crear = () => {
    const nid = Math.max(0, ...(esIns ? s.insumos : s.prods).map(p => p.id)) + 1;
    const ok = esIns
      ? act(n => nuevoInsumo(n, nn, nu, 0, 0, 0), `Insumo «${nn.trim()}» creado.`)
      : act(n => nuevoProd(n, nn, np, 0, 0, 0), `Producto «${nn.trim()}» creado.`);
    if (ok) { setPid(nid); setNuevo(false); setNn(''); setNp(0); }
  };
  const nom = (l: Ln) => (l.ins ? s.insumos.find(i => i.id === l.pid) : s.prods.find(p => p.id === l.pid))?.name;
  const pg = usePago(s); const iv = useIva();
  const sub = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  return (<>
    <div className="pills">
      <button className={!esIns ? 'on' : ''} onClick={() => cambiar(false)}>📦 Productos</button>
      <button className={esIns ? 'on' : ''} onClick={() => cambiar(true)}>🧂 Insumos</button></div>
    <h3>Agregar {esIns ? 'insumos' : 'productos'} al detalle</h3>
    {!lista.length && <p className="mut">{esIns ? 'Todavía no hay insumos. Creá el primero con «Crear nuevo».' : 'Todavía no hay productos. Creá el primero con «Crear nuevo».'}</p>}
    <div className="form">
      <label>{esIns ? 'Insumo' : 'Producto'}<select value={pid} onChange={e => setPid(+e.target.value)}>
        {lista.map(p => <option key={p.id} value={p.id}>{p.name} (stock {p.stock}{'unit' in p ? ' ' + p.unit : ''})</option>)}</select></label>
      <label>Cantidad<input type="number" min={0} step="any" value={qty} onChange={e => setQty(+e.target.value)} /></label>
      <label>Costo unitario<input type="number" min={0} value={costo} onChange={e => setCosto(+e.target.value)} /></label>
      <div style={{ alignSelf: 'end' }}><button disabled={qty <= 0 || !pid} onClick={() => { setLines([...lines, { pid, qty, cost: costo, ins: esIns }]); setQty(1); setCosto(0); }}>➕ Agregar</button></div></div>
    <div className="pills"><button onClick={() => setNuevo(!nuevo)}>{nuevo ? '✖ Cancelar' : `✨ Crear ${esIns ? 'insumo' : 'producto'} nuevo`}</button></div>
    {nuevo && <div className="form">
      <label>Nombre<input value={nn} onChange={e => setNn(e.target.value)} placeholder={esIns ? 'Ej: Harina 000' : 'Ej: Medialuna'} /></label>
      {esIns
        ? <label>Unidad<input value={nu} onChange={e => setNu(e.target.value)} placeholder="kg, lt, u…" /></label>
        : <label>Precio de venta<input type="number" min={0} value={np} onChange={e => setNp(+e.target.value)} /></label>}
      <div style={{ alignSelf: 'end' }}><button className="p" disabled={!nn.trim() || (!esIns && !(np > 0))} onClick={crear}>💾 Crear</button></div></div>}
    <h3>Detalle de la compra</h3>
    {!lines.length && <p className="mut">Agregá uno o más productos o insumos antes de registrar.</p>}
    {lines.map((l, i) => (<div className="row" key={i}><span><b>{l.qty}×</b> {l.ins ? '🧂 ' : ''}{nom(l)}</span>
      <span>{money(l.qty * l.cost)} <button onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></span></div>))}
    {!!lines.length && <Totales sub={sub} pct={iv.pct} inc={iv.inc} />}
    <div className="form"><label>Proveedor<input value={prov} onChange={e => setProv(e.target.value)} placeholder="Ej: Distribuidora Sur" /></label>{pg.ui}{iv.ui}</div>
    <button className="p" disabled={!lines.length} onClick={() => { if (act(n => compra(n, lines, pg.medio, pg.estado, pg.vence, prov.trim(), iv.pct, iv.inc), 'Compra registrada.')) { setLines([]); setProv(''); } }}>Registrar compra</button>
    <p className="mut">Suma stock y recalcula el costo promedio ponderado. Los insumos suman al stock de insumos. Con IVA incluido, el costo se guarda sin IVA.</p></>);
}

function Gasto({ s, act }: { s: S; act: Act }) {
  const [lines, setLines] = useState<GLn[]>([]); const [prov, setProv] = useState('');
  const [cat, setCat] = useState(CATS[0]); const [desc, setDesc] = useState(''); const [monto, setMonto] = useState(0);
  const pg = usePago(s); const iv = useIva();
  const sub = lines.reduce((a, l) => a + l.monto, 0);
  return (<>
    <h3>Agregar gastos o servicios al detalle</h3>
    <div className="form">
      <label>Categoría<select value={cat} onChange={e => setCat(e.target.value)}>{CATS.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Descripción<input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Ej: factura de luz" /></label>
      <label>Monto<input type="number" min={0} value={monto} onChange={e => setMonto(+e.target.value)} /></label>
      <div style={{ alignSelf: 'end' }}><button disabled={!(monto > 0)} onClick={() => { setLines([...lines, { cat, desc: desc.trim(), monto }]); setDesc(''); setMonto(0); }}>➕ Agregar</button></div></div>
    <h3>Detalle del gasto</h3>
    {!lines.length && <p className="mut">Agregá uno o más gastos antes de registrar.</p>}
    {lines.map((l, i) => (<div className="row" key={i}><span><b>{l.cat}</b>{l.desc && `: ${l.desc}`}</span>
      <span>{money(l.monto)} <button onClick={() => setLines(lines.filter((_, k) => k !== i))}>✕</button></span></div>))}
    {!!lines.length && <Totales sub={sub} pct={iv.pct} inc={iv.inc} />}
    <div className="form"><label>Proveedor<input value={prov} onChange={e => setProv(e.target.value)} placeholder="Ej: Edenor" /></label>{pg.ui}{iv.ui}</div>
    <button className="p" disabled={!lines.length} onClick={() => { if (act(n => gasto(n, lines, pg.medio, pg.estado, pg.vence, prov.trim(), iv.pct, iv.inc), 'Gasto registrado.')) { setLines([]); setProv(''); } }}>Registrar gasto</button>
    <p className="mut">El IVA sale de la caja pero no cuenta como gasto en el estado de resultados.</p></>);
}

/* ───────── Cuentas corrientes: cobro / pago total o parcial ───────── */
function LiqRow({ s, act, t, cobro, onDone }: { s: S; act: Act; t: Tx; cobro: boolean; onDone?: () => void }) {
  const ms = s.medios.filter(m => m.tipo !== 'credito').map(m => m.name);
  const [medio, setM] = useState(ms[0]); const [m, setMonto] = useState('');
  const sd = saldo(s, t), parcial = m !== '' && +m > 0 && +m < sd - 0.005;
  return (<div className="row">
    <span>#{t.id} · {t.desc.slice(0, 50)} · total {money(t.amount)} · <b>saldo {money(sd)}</b>
      {t.due && <span className={venc(t) ? 'neg' : 'mut'}> · vence {t.due.slice(5).split('-').reverse().join('/')}{venc(t) ? ' ⚠️ vencida' : ''}</span>}</span>
    <span>
      <select value={medio} onChange={e => setM(e.target.value)}>{ms.map(x => <option key={x}>{x}</option>)}</select>{' '}
      <input type="number" min={0} style={{ width: 110 }} placeholder={`Saldo ${Math.round(sd)}`} value={m} onChange={e => setMonto(e.target.value)} />{' '}
      <button onClick={() => setMonto(String(sd))} title="Completar con el saldo">Todo</button>{' '}
      <button className="p" onClick={() => { if (act(n => liquidar(n, t.id, medio, m === '' ? undefined : +m), `${cobro ? 'Cobro' : 'Pago'}${parcial ? ' parcial' : ''} registrado.`)) { setMonto(''); onDone?.(); } }}>
        {cobro ? 'Cobrar' : 'Pagar'}{parcial ? ' parcial' : ''}</button></span></div>);
}

function Liquidar({ s, act, cobro }: { s: S; act: Act; cobro: boolean }) {
  const pend = por(s, cobro ? ['SALE'] : ['PURCHASE', 'EXPENSE']).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
  if (!pend.length) return <p className="mut">{cobro ? 'No hay cuentas por cobrar.' : 'No hay cuentas por pagar.'} 🎉</p>;
  return (<><p className="mut">Dejá el monto vacío para saldar todo, o escribí un abono parcial: el saldo queda pendiente.</p>
    {pend.map(t => <LiqRow key={t.id} s={s} act={act} t={t} cobro={cobro} />)}</>);
}

function Registrar({ s, act }: { s: S; act: Act }) {
  const [t, setT] = useState('venta');
  const tabs = { venta: '🛒 Venta', compra: '📥 Compra', gasto: '💸 Gasto', cobro: '💰 Cobro', pago: '🏦 Pago' };
  return (<div>
    <div className="pills">{Object.entries(tabs).map(([k, v]) => <button key={k} className={t === k ? 'on' : ''} onClick={() => setT(k)}>{v}</button>)}</div>
    {t === 'venta' && <Venta s={s} act={act} />}{t === 'compra' && <Compra s={s} act={act} />}{t === 'gasto' && <Gasto s={s} act={act} />}
    {t === 'cobro' && <Liquidar s={s} act={act} cobro />}{t === 'pago' && <Liquidar s={s} act={act} cobro={false} />}</div>);
}

function ModA({ s, act }: { s: S; act: Act }) {
  const [v, setV] = useState('reg');
  const tabs = { reg: '✏️ Registrar', ape: '🔓 Apertura', cie: '🔒 Cierre', mov: '💱 Movimientos' };
  return (<div className="box">
    <div className="row"><h3>Caja</h3><EstadoCaja s={s} /></div>
    <div className="pills">{Object.entries(tabs).map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => setV(k)}>{l}</button>)}</div>
    {v === 'reg' && (abierta(s) ? <Registrar s={s} act={act} /> : <p className="neg">🔒 La caja está cerrada. Abrila en la pestaña Apertura para operar.</p>)}
    {v === 'ape' && <Apertura s={s} act={act} />}
    {v === 'cie' && <Cierre s={s} act={act} />}
    {v === 'mov' && <Movs s={s} act={act} />}</div>);
}

/* ───────── Insumos con actualización en cadena ───────── */
function Insumos({ s, act }: { s: S; act: Act }) {
  const v0 = { name: '', unit: 'kg', cost: 0, stock: 0, min: 0 };
  const [f, setF] = useState(v0);
  const [ed, setEd] = useState<{ id: number; cost: number } | null>(null);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: k === 'name' || k === 'unit' ? v : +v });
  const ins = ed ? s.insumos.find(i => i.id === ed.id) : undefined;
  const imp = ed ? impactoCosto(s, ed.id, ed.cost) : [];
  const guardar = (recalc: boolean) => {
    if (!ed) return;
    const msg = imp.length
      ? `Costo de «${ins?.name}» actualizado. Se recalculó el costo de ${imp.length} producto(s)${recalc ? ' y sus precios de venta' : ''}.`
      : `Costo de «${ins?.name}» actualizado.`;
    if (act(n => cambiarCostoInsumo(n, ed.id, ed.cost, recalc), msg)) setEd(null);
  };
  return (<div className="box" style={{ marginTop: 14 }}><h3>🧂 Stock de insumos</h3><div className="grid">
    <div className="scroll"><table><thead><tr><th>Insumo</th><th>Stock</th><th>Mín.</th><th>Costo / unidad</th><th>Valor</th><th></th></tr></thead><tbody>
      {s.insumos.map(i => { const bajo = i.stock < i.min; return (<tr key={i.id} className={bajo ? 'neg' : ''}>
        <td>{i.name}</td><td>{bajo ? '⚠️ ' : ''}{i.stock} {i.unit}</td><td>{i.min}</td><td>{money(i.cost)}</td><td>{money(i.stock * i.cost)}</td>
        <td><button onClick={() => setEd({ id: i.id, cost: i.cost })}>✏️ Costo</button></td></tr>); })}</tbody></table>
      {!s.insumos.length && <p className="mut">Todavía no cargaste insumos.</p>}</div>
    <div><h3>Nuevo insumo</h3><div className="form">
      <label>Nombre<input value={f.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Harina 000" /></label>
      <label>Unidad<input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="kg, lt, u…" /></label>
      <label>Costo por unidad<input type="number" value={f.cost} onChange={e => set('cost', e.target.value)} /></label>
      <label>Stock inicial<input type="number" step="any" value={f.stock} onChange={e => set('stock', e.target.value)} /></label>
      <label>Stock mínimo<input type="number" step="any" value={f.min} onChange={e => set('min', e.target.value)} /></label></div>
      <button className="p" onClick={() => { if (act(n => nuevoInsumo(n, f.name, f.unit, f.cost, f.stock, f.min), `Insumo «${f.name.trim()}» creado.`)) setF(v0); }}>Crear insumo</button></div>
  </div>
    {ed && ins && (<div className="box" style={{ marginTop: 14 }}>
      <h3>Cambiar costo de «{ins.name}»</h3>
      <div className="form"><label>Costo actual {money(ins.cost)} → nuevo costo por {ins.unit}
        <input type="number" min={0} value={ed.cost} onChange={e => setEd({ id: ed.id, cost: +e.target.value })} /></label></div>
      {imp.length ? (<>
        <div style={warnSt}>⚠️ Este cambio afecta a {imp.length} receta(s) / producto(s) terminado(s).</div>
        <div className="scroll"><table><thead><tr><th>Receta / producto</th><th>Costo unit. antes</th><th>Costo unit. después</th><th>Precio actual</th><th>Precio sugerido</th><th>Margen con precio actual</th></tr></thead><tbody>
          {imp.map(r => (<tr key={r.id}><td>{r.name}</td><td>{money(r.antes)}</td><td className={r.despues > r.antes ? 'neg' : ''}>{money(r.despues)}</td>
            <td>{money(r.precio)}</td><td><b>{money(r.sug)}</b></td><td><Margen m={r.margen} c={s.cfg} /></td></tr>))}</tbody></table></div></>)
        : <p className="mut">Ninguna receta usa este insumo: el cambio no afecta precios.</p>}
      <div className="pills">
        <button className="p" onClick={() => guardar(true)}>💾 Guardar y recalcular precios</button>
        <button onClick={() => guardar(false)}>Guardar solo el costo</button>
        <button onClick={() => setEd(null)}>Cancelar</button></div>
      <p className="mut">«Recalcular» pone el precio sugerido usando el margen de venta de Configuración (y actualiza combos que incluyan esos productos).</p></div>)}
  </div>);
}

function ModB({ s, act }: { s: S; act: Act }) {
  const [f, setF] = useState({ name: '', price: 0, cost: 0, stock: 0, min: 5 });
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: k === 'name' ? v : +v });
  return (<><div className="box"><h3>Inventario y costos</h3><div className="grid"><div className="scroll"><table>
    <thead><tr><th>Producto</th><th>Stock</th><th>Mín.</th><th>Costo</th><th>Precio</th><th>Margen</th></tr></thead><tbody>
      {s.prods.map(p => { const bajo = stk(s, p) < p.min; const mg = p.price ? (p.price - p.cost) / p.price * 100 : 0; return (<tr key={p.id} className={bajo ? 'neg' : ''}>
        <td>{p.combo ? '🎁 ' : ''}{p.name}</td><td>{bajo ? '⚠️ ' : ''}{stk(s, p)}</td><td>{p.min}</td><td>{money(p.cost)}</td><td>{money(p.price)}</td>
        <td><Margen m={mg} c={s.cfg} /></td></tr>); })}</tbody></table>
      <Leyenda c={s.cfg} /></div>
    <div><h3>Nuevo producto</h3><div className="form">
      <label>Nombre<input value={f.name} onChange={e => set('name', e.target.value)} /></label>
      <label>Precio de venta<input type="number" value={f.price} onChange={e => set('price', e.target.value)} /></label>
      <label>Costo<input type="number" value={f.cost} onChange={e => set('cost', e.target.value)} /></label>
      <label>Stock inicial<input type="number" value={f.stock} onChange={e => set('stock', e.target.value)} /></label>
      <label>Stock mínimo<input type="number" value={f.min} onChange={e => set('min', e.target.value)} /></label></div>
      <button className="p" onClick={() => { if (act(n => nuevoProd(n, f.name, f.price, f.cost, f.stock, f.min), `Producto «${f.name.trim()}» creado.`)) setF({ name: '', price: 0, cost: 0, stock: 0, min: 5 }); }}>Crear producto</button></div>
  </div></div>
    <Insumos s={s} act={act} />
    <Combos s={s} act={act} />
    <Calc s={s} act={act} /></>);
}

/* ───────── Historial ───────── */
type Filtro = 'all' | 'pend' | 'venc' | 'paid';
const pasa = (t: Tx, f: Filtro) => f === 'all' ? true : t.void ? false
  : f === 'pend' ? t.status === 'PENDING' : f === 'venc' ? t.status === 'PENDING' && venc(t) : t.status === 'PAID';

function ModC({ s, act }: { s: S; act: Act }) {
  const [q, setQ] = useState(''); const k = q.trim().toLowerCase().replace('#', '');
  const [f, setF] = useState<Filtro>('all'); const [conf, setConf] = useState<number | null>(null); const [abId, setAbId] = useState<number | null>(null);
  const lista = [...s.txs].reverse().filter(t => pasa(t, f) && (!k || t.desc.toLowerCase().includes(k) || t.medio.toLowerCase().includes(k) || String(t.id) === k));
  const ING = ['SALE', 'COLLECTION'];
  const cnt = (x: Filtro) => s.txs.filter(t => pasa(t, x)).length;
  const filtros: [Filtro, string][] = [['all', '📚 Todas'], ['pend', '⏳ Pendientes'], ['venc', '⚠️ Vencidas'], ['paid', '✅ Pagadas']];
  const ab = abId != null ? s.txs.find(x => x.id === abId && !x.void && x.status === 'PENDING') : undefined;
  const cobrable = (t: Tx) => !t.void && t.status === 'PENDING' && ['SALE', 'PURCHASE', 'EXPENSE'].includes(t.type);
  return (<div className="box"><h3>Historial de transacciones</h3>
    <div className="pills">{filtros.map(([k2, l]) => <button key={k2} className={f === k2 ? 'on' : ''} onClick={() => setF(k2)}>{l} ({cnt(k2)})</button>)}</div>
    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por detalle, medio o #número" />
    {ab && (<div className="box" style={{ marginTop: 10 }}>
      <div className="row"><b>{ab.type === 'SALE' ? '💰 Cobrar cuenta corriente' : '🏦 Pagar cuenta pendiente'}</b><button onClick={() => setAbId(null)}>✕ Cerrar</button></div>
      <LiqRow s={s} act={act} t={ab} cobro={ab.type === 'SALE'} onDone={() => setAbId(null)} />
      {abonos0(s, ab.id) > 0 && <p className="mut">Ya se abonaron {money(abonos0(s, ab.id))} de {money(ab.amount)}.</p>}</div>)}
    <div className="scroll"><table><thead><tr><th>#</th><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Medio</th><th>Estado</th><th>Monto</th><th></th></tr></thead><tbody>
      {lista.map(t => { const sd = saldo(s, t); const parcial = t.status === 'PENDING' && sd < t.amount - 0.005; return (<tr key={t.id} style={t.void ? { opacity: .45 } : undefined}>
        <td>{t.id}</td><td>{fecha(t.at)}</td><td>{t.type}</td><td style={{ textAlign: 'left' }}>{t.desc}</td><td>{t.medio}</td>
        <td style={cobrable(t) ? { cursor: 'pointer' } : undefined} onClick={() => cobrable(t) && setAbId(t.id)} title={cobrable(t) ? 'Click para registrar un cobro o pago' : ''}>
          {t.void ? '❌ Anulada' : t.status === 'PAID' ? '✅ Pagado' : venc(t) ? '⚠️ Vencida' : '⏳ Pendiente'}{parcial ? ` · saldo ${money(sd)}` : ''}</td>
        <td className={ING.includes(t.type) ? 'pos' : ''}>{ING.includes(t.type) ? '+' : '−'}{money(t.amount)}</td>
        <td>{cobrable(t) && <button onClick={() => setAbId(t.id)}>{t.type === 'SALE' ? 'Cobrar' : 'Pagar'}</button>}{' '}
          {!t.void && (conf === t.id
            ? <span><span className="neg">¿Anular #{t.id}? Revierte stock y caja. </span>
              <button className="p" onClick={() => { act(n => anular(n, t.id), `Operación #${t.id} anulada.`); setConf(null); }}>Sí, anular</button>{' '}
              <button onClick={() => setConf(null)}>No</button></span>
            : <button onClick={() => setConf(t.id)}>Anular</button>)}</td></tr>); })}</tbody></table></div>
    {!lista.length && <p className="mut">No hay operaciones para mostrar.</p>}</div>);
}
const abonos0 = (s: S, id: number) => r2(s.txs.filter(t => !t.void && t.pays === id).reduce((a, x) => a + x.amount, 0));

/* ───────── Estados financieros ───────── */
function Tabla({ title, rows }: { title: string; rows: [string, number[], boolean?][] }) {
  return (<div className="scroll"><table><thead><tr><th>{title}</th>{MESES.map(m => <th key={m}>{m}</th>)}<th>Total</th></tr></thead><tbody>
    {rows.map(([l, v, sub]) => (<tr key={l} className={sub ? 's' : ''}><td>{l}</td>
      {[...v, v.reduce((a, b) => a + b, 0)].map((x, i) => <td key={i} className={x < 0 ? 'neg' : ''}>{Math.abs(x) < .005 ? '–' : money(x)}</td>)}</tr>))}</tbody></table></div>);
}

type Ser = { name: string; color: string; v: number[]; line?: boolean };
function Grafico({ title, labels, series }: { title: string; labels: string[]; series: Ser[] }) {
  const [h, setH] = useState<number | null>(null);
  const W = 640, H = 210, T = 10, B = 24, L = 8;
  const all = series.flatMap(x => x.v); const max = Math.max(1, ...all), min = Math.min(0, ...all), rng = max - min || 1;
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / rng);
  const gw = (W - L) / labels.length; const bars = series.filter(x => !x.line); const bw = Math.min(16, (gw - 6) / Math.max(bars.length, 1));
  return (<div style={{ marginTop: 12 }}><b>{title}</b>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 240 }} onMouseLeave={() => setH(null)}>
      <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="#30363d" />
      {labels.map((l, i) => { const x0 = L + i * gw; return (<g key={l} onMouseEnter={() => setH(i)} onClick={() => setH(i)}>
        <rect x={x0} y={0} width={gw} height={H} fill={h === i ? 'rgba(255,255,255,.07)' : 'transparent'} />
        {bars.map((se, k) => { const v = se.v[i]; return <rect key={se.name} x={x0 + (gw - bw * bars.length) / 2 + k * bw} y={Math.min(y(v), y(0))} width={bw - 1}
          height={Math.max(Math.abs(y(0) - y(v)), v ? 1 : 0)} fill={se.color} rx={2} />; })}
        <text x={x0 + gw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="#8b949e">{l}</text></g>); })}
      {series.filter(x => x.line).map(se => (<g key={se.name}>
        <polyline fill="none" stroke={se.color} strokeWidth={2} points={se.v.map((v, i) => `${L + i * gw + gw / 2},${y(v)}`).join(' ')} />
        {se.v.map((v, i) => <circle key={i} cx={L + i * gw + gw / 2} cy={y(v)} r={h === i ? 4.5 : 2.5} fill={se.color} />)}</g>))}
    </svg>
    <div className="pills">{series.map(se => <span key={se.name} className="mut"><span style={{ color: se.color }}>{se.line ? '━' : '■'}</span> {se.name}</span>)}</div>
    <p className="mut">{h != null ? `${labels[h]}: ` + series.map(se => `${se.name} ${money(se.v[h])}`).join(' · ') : 'Pasá el mouse (o tocá) un mes para ver el detalle.'}</p></div>);
}

function ModD({ s }: { s: S }) {
  const y = new Date().getFullYear();
  const er = MESES.map((_, i) => pyl(s, d => d.getFullYear() === y && d.getMonth() === i));
  const fl = { cobros: Array(12).fill(0), compras: Array(12).fill(0), gastos: Array(12).fill(0) };
  flows(s).forEach(f => { if (f.d.getFullYear() === y) fl[f.c][f.d.getMonth()] += f.a; });
  const neto = fl.cobros.map((c, i) => c - fl.compras[i] - fl.gastos[i]);
  const col = (k: 'v' | 'd' | 'vn' | 'c' | 'bruta' | 'g' | 'neta') => er.map(e => e[k]);
  const cobrar = por(s, ['SALE']).reduce((a, t) => a + saldo(s, t), 0), pagar = por(s, ['PURCHASE', 'EXPENSE']).reduce((a, t) => a + saldo(s, t), 0);
  const { caja, banco } = saldos(s);
  const hh = new Date(); const ivr = ivaRes(s, d => d.getFullYear() === hh.getFullYear() && d.getMonth() === hh.getMonth());
  const disp = caja + banco, m = hh.getMonth();
  const netaMes = er[m].neta, flujoMes = neto[m];
  const rw = (burn: number) => burn > 0 ? disp / burn : null;
  const rwRes = rw(-netaMes), rwFlu = rw(-flujoMes);
  const cRw = (v: number) => (v < 3 ? COL.bad : v < 6 ? COL.mid : COL.ok);
  const RW = ({ l, v, burn }: { l: string; v: number | null; burn: number }) => (<div className="row"><span>{l}</span>
    {v == null ? <b className="pos">Sin consumo de caja ✅</b> : <b style={{ color: cRw(v) }}>{v.toFixed(1)} meses <span className="mut">(pérdida de {money(burn)}/mes)</span></b>}</div>);
  return (<div className="box"><h3>Estado de resultados · {y}</h3>
    <Tabla title="Concepto" rows={[['Ventas', col('v')], ['(−) Descuentos', col('d').map(x => -x)], ['Ventas netas', col('vn'), true],
      ['(−) Costo de ventas', col('c').map(x => -x)], ['Utilidad bruta', col('bruta'), true], ['(−) Gastos', col('g').map(x => -x)], ['Utilidad neta', col('neta'), true]]} />
    <p className="mut">Criterio devengado: cuenta el día que se registra, aunque se cobre o pague después.</p>
    <Grafico title="📈 Ventas netas vs. costo vs. gastos" labels={MESES} series={[
      { name: 'Ventas netas', color: '#3fb950', v: col('vn') }, { name: 'Costo de ventas', color: '#d29922', v: col('c') },
      { name: 'Gastos', color: '#f85149', v: col('g') }, { name: 'Utilidad neta', color: '#58a6ff', v: col('neta'), line: true }]} />
    <h3 style={{ marginTop: 18 }}>Flujo de caja · {y}</h3>
    <Tabla title="Concepto" rows={[['Cobros', fl.cobros], ['(−) Compras', fl.compras.map(x => -x)], ['(−) Gastos', fl.gastos.map(x => -x)], ['Flujo del mes', neto, true]]} />
    <p className="mut">Solo plata que entró o salió de verdad (el fiado cuenta recién cuando se cobra o se paga).</p>
    <Grafico title="💧 Evolución del flujo de caja" labels={MESES} series={[
      { name: 'Cobros', color: '#3fb950', v: fl.cobros }, { name: 'Pagos (compras + gastos)', color: '#f85149', v: fl.compras.map((c, i) => c + fl.gastos[i]) },
      { name: 'Flujo neto', color: '#58a6ff', v: neto, line: true }]} />
    <h3 style={{ marginTop: 18 }}>Posición a hoy</h3>
    <div className="row"><span>Dinero disponible (caja + bancos)</span><b>{money(disp)}</b></div>
    <div className="row"><span>(+) Por cobrar</span><b className="pos">{money(cobrar)}</b></div>
    <div className="row"><span>(−) Por pagar</span><b className="neg">{money(pagar)}</b></div>
    <div className="row"><span>= Posición proyectada</span><b>{money(disp + cobrar - pagar)}</b></div>
    <h3 style={{ marginTop: 18 }}>🫁 Runway · oxígeno financiero</h3>
    <RW l={`Según resultado neto de ${MESES[m]}`} v={rwRes} burn={-netaMes} />
    <RW l={`Según flujo de caja de ${MESES[m]}`} v={rwFlu} burn={-flujoMes} />
    <p className="mut">Meses que aguanta el negocio con el dinero disponible si todo sigue como este mes (🔴 menos de 3 · 🟡 menos de 6 · 🟢 6 o más). Se calcula con lo registrado hasta hoy en el mes en curso.</p>
    <h3 style={{ marginTop: 18 }}>IVA del mes</h3>
    <div className="row"><span>IVA débito (ventas)</span><b>{money(ivr.deb)}</b></div>
    <div className="row"><span>(−) IVA crédito (compras y gastos)</span><b>{money(ivr.cred)}</b></div>
    <div className="row"><span>= {ivr.deb >= ivr.cred ? 'IVA a pagar' : 'Saldo a favor'}</span><b>{money(Math.abs(ivr.deb - ivr.cred))}</b></div></div>);
}

/* ───────── Calculadora de precios (directa + inversa) ───────── */
function Calc({ s, act }: { s: S; act: Act }) {
  const c = s.cfg;
  const [pid, setPid] = useState(0); const [costo, setCosto] = useState(0);
  const [mv, setMv] = useState(c.mv); const [mm, setMm] = useState(c.mm);
  const [sel, setSel] = useState<Sel>({ ...selDefault, desc: c.desc });
  const [vista, setVista] = useState('calc'); const [tipo, setTipo] = useState('min');
  const [pInv, setPInv] = useState(0); const [cInv, setCInv] = useState(1);
  const up = (k: keyof Sel, v: boolean | number) => setSel({ ...sel, [k]: v });
  const pr = s.prods.find(x => x.id === pid);
  const rMin = calcPrecio(costo, mv, c, sel), rMay = calcPrecio(costo, mm, c, sel);
  const inv = calcInverso(costo, pInv, c, sel, cInv);
  const chk = (k: 'pack' | 'envio' | 'com' | 'iibb' | 'ret', l: string) => (
    <label style={chkSt}><input type="checkbox" style={{ width: 'auto' }} checked={sel[k]} onChange={e => up(k, e.target.checked)} />{l}</label>);
  const r = tipo === 'min' ? rMin : rMay, mg = tipo === 'min' ? mv : mm;
  const R = (l: string, v: string, cls = '') => <div className="row" key={l}><span className="mut">{l}</span><b className={cls}>{v}</b></div>;
  const vistas = [['calc', '🧮 Calculadora'], ['des', '📋 Desglose'], ['inv', '🔁 Precio inverso']];
  return (<div className="box" style={{ marginTop: 14 }}><h3>💲 Calculadora de precios</h3>
    <div className="pills">{vistas.map(([k, v]) => <button key={k} className={vista === k ? 'on' : ''} onClick={() => setVista(k)}>{v}</button>)}</div>
    {vista === 'calc' && <div className="grid"><div>
      <div className="form">
        <label>Producto<select value={pid} onChange={e => { const id = +e.target.value; setPid(id); setCosto(s.prods.find(x => x.id === id)?.cost ?? 0); }}>
          <option value={0}>— Manual —</option>{s.prods.map(x => <option key={x.id} value={x.id}>{x.combo ? '🎁 ' : ''}{x.name}</option>)}</select></label>
        <label>Costo base $<input type="number" min={0} value={costo} onChange={e => setCosto(+e.target.value)} /></label>
        <label>Margen venta %<input type="number" value={mv} onChange={e => setMv(+e.target.value)} /></label>
        <label>Margen mayorista %<input type="number" value={mm} onChange={e => setMm(+e.target.value)} /></label>
        <label>Descuento %<input type="number" value={sel.desc} onChange={e => up('desc', +e.target.value)} /></label></div>
      <div className="pills">{chk('pack', `Packaging (${money(c.packaging)})`)}{chk('envio', `Envío (${money(c.envio)})`)}
        {chk('com', `Comisión (${c.comision}%)`)}{chk('iibb', `Ing. Brutos (${c.iibb}%)`)}{chk('ret', `Retenciones (${c.retenciones}%)`)}</div>
      <div className="form">
        <label>Pasarela de pagos<select value={sel.pas} onChange={e => up('pas', +e.target.value)}><option value={0}>Ninguna</option>
          {c.pasarelas.map((x, i) => <option key={i} value={i + 1}>{x.name} · {x.pct}%</option>)}</select></label>
        <label>Plataforma<select value={sel.plat} onChange={e => up('plat', +e.target.value)}><option value={0}>Ninguna</option>
          {c.plataformas.map((x, i) => <option key={i} value={i + 1}>{x.name} · {x.pct}%</option>)}</select></label></div>
      {(c.trasladaCom || c.trasladaCuotas) && <p className="mut">💡 Comisiones de pasarela/plataforma{c.trasladaCuotas ? ' y recargo por cuotas' : ''} se trasladan al cliente: no reducen tu margen, se suman a lo que paga.</p>}</div>
      <div>{costo <= 0 ? <p className="mut">Elegí un producto o ingresá un costo base para calcular.</p>
        : !rMin || !rMay ? <p className="neg">Margen + comisiones + impuestos suman 100% o más. Bajá el margen o sacá algún cargo.</p> : (<>
        <div className="kpis">
          <div className="kpi"><small>Precio minorista</small><strong className="pos">{money(rMin.lista)}</strong>{sel.desc > 0 && <small>Cliente paga {money(rMin.final)}</small>}
            {rMin.recargo > 0 && <small>Con recargos paga {money(rMin.cliente)}</small>}</div>
          <div className="kpi"><small>Precio mayorista</small><strong>{money(rMay.lista)}</strong></div>
          <div className="kpi"><small>Ganancia por unidad</small><strong>{money(rMin.ganancia)}</strong></div>
          <div className="kpi"><small>Margen real</small><strong style={{ color: semaf(rMin.real, c) }}>{ico(rMin.real, c)} {rMin.real.toFixed(1)}%</strong></div></div>
        {pr && <button className="p" onClick={() => act(n => { const q = n.prods.find(x => x.id === pid); if (!q) return 'Producto inexistente.'; q.price = rMin.lista; return null; }, `Precio de «${pr.name}» actualizado a ${money(rMin.lista)}.`)}>Aplicar minorista a «{pr.name}»</button>}</>)}</div></div>}

    {vista === 'des' && (costo <= 0 ? <p className="mut">Primero elegí un producto o ingresá un costo en la pestaña Calculadora.</p> : (<>
      <div className="pills">{[['min', 'Minorista'], ['may', 'Mayorista']].map(([k, v]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{v}</button>)}</div>
      {!r ? <p className="neg">Los porcentajes suman 100% o más.</p> : (<div className="grid"><div>
        {R('Precio de lista', money(r.lista))}{r.d > 0 && R(`(−) Descuento ${r.d}%`, money(r.descMonto), 'neg')}{r.d > 0 && R('= Precio final al cliente', money(r.final), 'pos')}
        {R('(−) Costo base', money(r.costo), 'neg')}{r.fijos.map(([n, v]) => R(`(−) ${n}`, money(v), 'neg'))}
        {r.ded.map(([n, v, x, t]) => R(`${t ? '(cliente paga) ' : '(−) '}${n} ${x}%`, money(v), t ? 'mut' : 'neg'))}
        {R('= Ganancia neta por unidad', money(r.ganancia), r.ganancia >= 0 ? 'pos' : 'neg')}
        <div className="row"><span className="mut">Margen real</span><Margen m={r.real} c={c} /></div></div>
        <div className="scroll"><table><thead><tr><th>Cuotas</th>{c.pasarelas.map(x => <th key={x.name}>{x.name}</th>)}</tr></thead><tbody>
          {[1, ...CUOTAS].map(n => <tr key={n}><td>{n === 1 ? '1 pago' : `${n} cuotas`}</td>
            {c.pasarelas.map((x, i) => { const q = calcPrecio(costo, mg, c, sel, n, i + 1); return <td key={i}>{q ? money(q.lista) : 'n/d'}</td>; })}</tr>)}</tbody></table>
          <p className="mut">Mantiene el margen elegido: el recargo de cada cuota se suma a los cargos del precio{c.trasladaCuotas ? ' (hoy lo paga el cliente)' : ''}.</p></div></div>)}</>))}

    {vista === 'inv' && (costo <= 0 ? <p className="mut">Primero elegí un producto o ingresá un costo base en la pestaña Calculadora.</p> : (<div className="grid"><div>
      <p className="mut">Si el mercado te impone el precio, acá ves cuánto ganás de verdad. Usa el costo, los cargos y el descuento marcados en la Calculadora.</p>
      <div className="form">
        <label>Costo base: {money(costo)}<input readOnly value={money(costo)} /></label>
        <label>Precio de venta fijo $<input type="number" min={0} value={pInv || ''} placeholder={rMin ? `Sugerido ${rMin.lista}` : ''} onChange={e => setPInv(+e.target.value)} /></label>
        <label>Cuotas<select value={cInv} onChange={e => setCInv(+e.target.value)}>{[1, ...CUOTAS].map(n => <option key={n} value={n}>{n === 1 ? '1 pago' : `${n} cuotas`}</option>)}</select></label></div>
      {cInv > 1 && sel.pas === 0 && <p className="mut">Para aplicar el recargo de cuotas elegí una pasarela en la pestaña Calculadora.</p>}
      {rMin && <button onClick={() => setPInv(rMin.lista)}>Usar precio sugerido ({money(rMin.lista)})</button>}</div>
      <div>{!inv ? <p className="mut">Ingresá el precio de venta para ver tu margen real.</p> : (<>
        <div className="kpis">
          <div className="kpi"><small>Ganancia por unidad</small><strong className={inv.ganancia >= 0 ? 'pos' : 'neg'}>{money(inv.ganancia)}</strong></div>
          <div className="kpi"><small>Margen real</small><strong style={{ color: semaf(inv.real, c) }}>{ico(inv.real, c)} {inv.real.toFixed(1)}%</strong></div>
          <div className="kpi"><small>Markup sobre costo</small><strong>{inv.markup.toFixed(1)}%</strong></div>
          {inv.recargo > 0 && <div className="kpi"><small>El cliente paga</small><strong>{money(inv.cliente)}</strong></div>}</div>
        {R('Precio de venta', money(inv.lista))}{inv.d > 0 && R(`(−) Descuento ${inv.d}%`, money(inv.descMonto), 'neg')}
        {R('(−) Costo base', money(inv.costo), 'neg')}{inv.fijos.map(([n, v]) => R(`(−) ${n}`, money(v), 'neg'))}
        {inv.ded.map(([n, v, x, t]) => R(`${t ? '(cliente paga) ' : '(−) '}${n} ${x}%`, money(v), t ? 'mut' : 'neg'))}
        {R('= Ganancia neta', money(inv.ganancia), inv.ganancia >= 0 ? 'pos' : 'neg')}
        <p className={inv.real >= mv ? 'pos' : 'neg'}>{inv.real >= mv ? `✅ Superás tu margen objetivo (${mv}%).` : `⚠️ Quedás ${(mv - inv.real).toFixed(1)} puntos por debajo de tu margen objetivo (${mv}%).`}</p></>)}</div></div>))}
  </div>);
}

/* ───────── Configuración ───────── */
function Config({ s, act }: { s: S; act: Act }) {
  const [neg, setNeg] = useState(s.neg); const [caja0, setCaja] = useState(s.caja0); const [banco0, setBanco] = useState(s.banco0);
  const [c, setC] = useState<Cfg>(() => structuredClone(s.cfg));
  const [medios, setMedios] = useState<Medio[]>(() => structuredClone(s.medios));
  const ed = (f: (d: Cfg) => void) => { const d = structuredClone(c); f(d); setC(d); };
  const N = (l: string, v: number, f: (d: Cfg, x: number) => void) => <label>{l}<input type="number" value={v} onChange={e => ed(d => f(d, +e.target.value))} /></label>;
  const T = (l: string, k: keyof typeof neg) => <label>{l}<input value={neg[k]} onChange={e => setNeg({ ...neg, [k]: e.target.value })} /></label>;
  const B = (l: string, k: 'trasladaCom' | 'trasladaCuotas' | 'bloqueaMin', ayuda: string) => (<div style={{ margin: '6px 0' }}>
    <label style={chkSt}><input type="checkbox" style={{ width: 'auto' }} checked={c[k]} onChange={e => ed(d => { d[k] = e.target.checked; })} />{l}</label>
    <span className="mut">{ayuda}</span></div>);
  return (<div className="grid">
    <div className="box"><h3>🏢 Datos de tu negocio</h3>
      <div className="form">{T('Nombre del negocio *', 'nombre')}{T('CUIT', 'cuit')}{T('Teléfono', 'tel')}{T('Dirección', 'dir')}{T('Email', 'email')}</div>
      <h3>Saldos iniciales</h3>
      <div className="form"><label>Caja chica inicial<input type="number" value={caja0} onChange={e => setCaja(+e.target.value)} /></label>
        <label>Bancos / Digital inicial<input type="number" value={banco0} onChange={e => setBanco(+e.target.value)} /></label></div>
      <button className="p" onClick={() => act(n => { if (!neg.nombre.trim()) return 'Escribí el nombre del negocio.'; n.neg = { ...neg, nombre: neg.nombre.trim() }; n.caja0 = caja0; n.banco0 = banco0; return null; }, 'Datos del negocio guardados.')}>Guardar datos</button></div>
    <div className="box"><h3>💳 Costos de financiación</h3>
      {B('Trasladar comisiones al cliente', 'trasladaCom', ' Comisión de pasarela, plataforma (Mercado Pago, Tienda Nube…) y del medio de pago: se suma al ticket en vez de salir de tu margen.')}
      {B('Trasladar recargo por cuotas al cliente', 'trasladaCuotas', ' Si está apagado, lo absorbe el comercio y baja tu ganancia.')}
      {B('Bloquear ventas bajo el stock mínimo', 'bloqueaMin', ' Si está apagado, solo se muestra una advertencia.')}
      <h3>Comisión por medio de pago (%)</h3>
      <div className="form">{medios.map((m, i) => m.tipo === 'credito' ? null : (
        <label key={m.name}>{m.name}<input type="number" min={0} value={m.com ?? 0} onChange={e => setMedios(medios.map((x, k) => k === i ? { ...x, com: +e.target.value } : x))} /></label>))}</div>
      <p className="mut">Se aplica en la registradora cuando «Trasladar comisiones» está activo.</p>
      <h3>🚦 Semáforo de rentabilidad</h3>
      <div className="form">{N('Margen saludable desde %', c.mgOk, (d, x) => d.mgOk = x)}{N('Margen en riesgo debajo de %', c.mgBajo, (d, x) => d.mgBajo = x)}</div>
      <h3>💲 Calculadora de precios</h3>
      <div className="form">{N('Packaging $ / unidad', c.packaging, (d, x) => d.packaging = x)}{N('Envío $ / unidad', c.envio, (d, x) => d.envio = x)}
        {N('Comisión vendedor %', c.comision, (d, x) => d.comision = x)}{N('Ingresos Brutos %', c.iibb, (d, x) => d.iibb = x)}{N('Retenciones %', c.retenciones, (d, x) => d.retenciones = x)}
        <label>Redondeo<select value={c.redTipo} onChange={e => ed(d => d.redTipo = e.target.value)}>{REDONDEOS.map(r => <option key={r}>{r}</option>)}</select></label>
        {N('Múltiplo $', c.redMult, (d, x) => d.redMult = x)}{N('Margen venta %', c.mv, (d, x) => d.mv = x)}{N('Margen mayorista %', c.mm, (d, x) => d.mm = x)}{N('Descuento %', c.desc, (d, x) => d.desc = x)}</div>
      <h3>Pasarelas de pago</h3>
      {c.pasarelas.map((x, i) => <div className="form" key={i}><label>Nombre<input value={x.name} onChange={e => ed(d => d.pasarelas[i].name = e.target.value)} /></label>{N('%', x.pct, (d, v) => d.pasarelas[i].pct = v)}</div>)}
      <h3>Plataformas</h3>
      {c.plataformas.map((x, i) => <div className="form" key={i}><label>Nombre<input value={x.name} onChange={e => ed(d => d.plataformas[i].name = e.target.value)} /></label>{N('%', x.pct, (d, v) => d.plataformas[i].pct = v)}</div>)}
      <h3>Recargos por cuotas (%)</h3>
      <div className="scroll"><table><thead><tr><th>Cuotas</th>{c.pasarelas.map(x => <th key={x.name}>{x.name}</th>)}</tr></thead><tbody>
        {CUOTAS.map(n => <tr key={n}><td>{n} cuotas</td>{c.cuotas[n].map((v, i) => <td key={i}><input type="number" style={{ width: 80 }} value={v} onChange={e => ed(d => d.cuotas[n][i] = +e.target.value)} /></td>)}</tr>)}</tbody></table></div>
      <div className="pills"><button className="p" onClick={() => act(n => {
        if ([...c.pasarelas, ...c.plataformas].some(x => !x.name.trim())) return 'Todas las pasarelas y plataformas necesitan un nombre.';
        if (c.mgBajo > c.mgOk) return 'El margen «en riesgo» no puede superar al «saludable».';
        n.cfg = c; n.medios = medios; return null; }, 'Configuración guardada.')}>Guardar configuración</button>
        <button onClick={() => act(n => { for (const q of n.prods) if (q.cost > 0) { const r = calcPrecio(q.cost, n.cfg.mv, n.cfg, selDefault); if (r) q.price = r.lista; } return null; }, 'Precios recalculados con el margen de venta, Ing. Brutos y retenciones.')}>Recalcular todos los productos</button></div>
      <p className="mut">«Recalcular» usa el margen de venta guardado, Ing. Brutos y retenciones. Guardá la configuración primero.</p></div></div>);
}

/* ───────── Recetas y fabricación ───────── */
function Recetas({ s, act }: { s: S; act: Act }) {
  const [v, setV] = useState('nueva');
  const tabs = { nueva: '📝 Nueva receta', fab: '🏭 Fabricar', rec: '📖 Recetario' };
  return (<div className="box"><h3>📋 Recetas y fabricación</h3>
    <div className="pills">{Object.entries(tabs).map(([k, l]) => <button key={k} className={v === k ? 'on' : ''} onClick={() => setV(k)}>{l}</button>)}</div>
    {v === 'nueva' && <NuevaReceta s={s} act={act} />}{v === 'fab' && <Fabricar s={s} act={act} />}{v === 'rec' && <Recetario s={s} act={act} />}</div>);
}

function NuevaReceta({ s, act }: { s: S; act: Act }) {
  const [name, setName] = useState(''); const [lote, setLote] = useState(12); const [unidad, setUnidad] = useState('Unidad');
  const [ins, setIns] = useState<RLn[]>([]); const [iid0, setIid] = useState(0); const [cant, setCant] = useState(0); const [mIns, setMIns] = useState('');
  const iid = s.insumos.some(i => i.id === iid0) ? iid0 : s.insumos[0]?.id ?? 0;
  const [mo, setMo] = useState(0); const [cfMes, setCfMes] = useState(0); const [hMes, setHMes] = useState(200); const [hLote, setHLote] = useState(1);
  const [merma, setMerma] = useState(0);
  const cf = hMes > 0 ? cfMes / hMes * hLote : 0;
  const c = costoReceta(s, { ins, mo, cf, merma, lote });
  const reset = () => { setName(''); setIns([]); setCant(0); setMIns(''); setMo(0); setCfMes(0); setMerma(0); };
  return (<div className="grid"><div>
    <div className="form">
      <label>Nombre de la receta *<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Medialunas de manteca" /></label>
      <label>Cantidad por lote (rinde)<input type="number" min={1} value={lote} onChange={e => setLote(+e.target.value)} /></label>
      <label>Unidad de venta<input value={unidad} onChange={e => setUnidad(e.target.value)} /></label></div>
    <h3>Insumos utilizados</h3>
    {!s.insumos.length && <p className="mut">Creá insumos primero en Inventario y costos.</p>}
    <div className="form">
      <label>Insumo<select value={iid} onChange={e => setIid(+e.target.value)}>{s.insumos.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label>
      <label>Cantidad por lote<input type="number" min={0} step="any" value={cant} onChange={e => setCant(+e.target.value)} /></label>
      <label>Merma % de este insumo<input type="number" min={0} step="any" value={mIns} placeholder={`Vacío = general (${merma}%)`} onChange={e => setMIns(e.target.value)} /></label>
      <div style={{ alignSelf: 'end' }}><button disabled={!iid || cant <= 0 || ins.some(l => l.iid === iid)} onClick={() => { setIns([...ins, { iid, qty: cant, merma: mIns === '' ? undefined : +mIns }]); setCant(0); setMIns(''); }}>➕ Agregar insumo</button></div></div>
    {ins.map((l, i) => { const x = s.insumos.find(q => q.id === l.iid); return (<div className="row" key={l.iid}>
      <span><b>{l.qty} {x?.unit}</b> {x?.name} <span className="mut">· merma {l.merma ?? merma}%{l.merma == null ? ' (general)' : ''}</span></span>
      <span>{money(l.qty * (x?.cost ?? 0))} <button onClick={() => setIns(ins.filter((_, k) => k !== i))}>✕</button></span></div>); })}
    <h3>Mano de obra, costos fijos y merma</h3>
    <div className="form">
      <label>Mano de obra del lote $<input type="number" min={0} value={mo} onChange={e => setMo(+e.target.value)} /></label>
      <label>Costos fijos del mes $<input type="number" min={0} value={cfMes} onChange={e => setCfMes(+e.target.value)} /></label>
      <label>Horas al mes abierto<input type="number" min={1} value={hMes} onChange={e => setHMes(+e.target.value)} /></label>
      <label>Horas para este lote<input type="number" min={0} step="any" value={hLote} onChange={e => setHLote(+e.target.value)} /></label>
      <label>Merma general %<input type="number" min={0} value={merma} onChange={e => setMerma(+e.target.value)} /></label></div>
    <p className="mut">La merma general se aplica a los insumos que no tengan una propia. Ej: manteca 8%, harina 3%, resto 5% general.</p>
  </div>
  <div>
    <h3>Resumen de costos</h3>
    <div className="row"><span className="mut">Insumos (lote)</span><span>{money(c.ins)}</span></div>
    <div className="row"><span className="mut">Mano de obra</span><span>{money(c.mo)}</span></div>
    <div className="row"><span className="mut">Costos fijos asignados</span><span>{money(c.cf)}</span></div>
    <div className="row"><span className="mut">Merma (por insumo)</span><span>{money(c.merma)}</span></div>
    <div className="row"><span className="mut">Costo total del lote</span><strong>{money(c.total)}</strong></div>
    <div className="row"><span className="mut">Costo por {unidad.toLowerCase() || 'unidad'}</span><strong style={{ fontSize: 24 }}>{money(c.unit)}</strong></div>
    <button className="p" onClick={() => { if (act(n => nuevaReceta(n, name, lote, unidad, ins, mo, cf, merma), `Receta «${name.trim()}» guardada y producto creado en stock.`)) reset(); }}>💾 Guardar receta</button>
    <p className="mut">Crea el producto terminado (con stock 0) o lo vincula si ya existe. El stock se suma al fabricar.</p>
  </div></div>);
}

function Fabricar({ s, act }: { s: S; act: Act }) {
  const [rid, setRid] = useState(s.recetas[0]?.id ?? 0); const [qty, setQty] = useState(1); const [desc, setDesc] = useState(true);
  const r = s.recetas.find(x => x.id === rid) ?? s.recetas[0];
  if (!s.recetas.length) return <p className="mut">Primero guardá una receta.</p>;
  const c = r ? costoReceta(s, r) : null;
  return (<div className="grid"><div>
    <div className="form">
      <label>Receta<select value={r?.id ?? 0} onChange={e => setRid(+e.target.value)}>{s.recetas.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Unidad de venta<input readOnly value={r?.unidad ?? ''} /></label>
      <label>Costo unitario<input readOnly value={c ? money(c.unit) : ''} /></label>
      <label>Cantidad a fabricar<input type="number" min={1} value={qty} onChange={e => setQty(+e.target.value)} /></label>
      <label>Descontar insumos del stock<select value={desc ? '1' : '0'} onChange={e => setDesc(e.target.value === '1')}>
        <option value="1">Sí, descontar insumos</option><option value="0">No descontar</option></select></label></div>
    <button className="p" onClick={() => act(n => fabricar(n, r!.id, qty, desc), `Fabricación registrada: +${qty} ${r?.name}.`)}>🏭 Registrar fabricación en stock</button></div>
    <div><h3>Insumos necesarios</h3>
      {r && r.ins.map(l => { const i = s.insumos.find(x => x.id === l.iid); const need = Math.round(l.qty * qty / r.lote * 1000) / 1000; const falta = !!i && i.stock < need;
        return (<div className="row" key={l.iid}><span>{i?.name}</span><span className={falta ? 'neg' : ''}>{need} {i?.unit} (hay {i?.stock}){falta ? ' ⚠️' : ''}</span></div>); })}
      {r && <p className="mut">Stock actual de «{r.name}»: {s.prods.find(p => p.id === r.pid)?.stock ?? 0}</p>}</div></div>);
}

function Recetario({ s, act }: { s: S; act: Act }) {
  return (<div>
    {!s.recetas.length && <p className="mut">No hay recetas guardadas.</p>}
    {s.recetas.map(r => { const c = costoReceta(s, r); const p = s.prods.find(x => x.id === r.pid); const mg = p && p.price > 0 ? (p.price - c.unit) / p.price * 100 : null;
      return (<div className="box" key={r.id} style={{ marginTop: 10 }}>
      <div className="row"><h3>{r.name}</h3><button onClick={() => act(n => eliminarReceta(n, r.id), 'Receta eliminada.')}>Eliminar</button></div>
      <p className="mut">Rinde {r.lote} {r.unidad.toLowerCase()} · Lote {money(c.total)} · <b>{money(c.unit)} c/u</b>{mg != null && <> · Margen con precio actual <Margen m={mg} c={s.cfg} /></>}</p>
      {r.ins.map(l => { const i = s.insumos.find(x => x.id === l.iid); return <div className="row" key={l.iid}><span>{i?.name ?? '(insumo eliminado)'} <span className="mut">· merma {l.merma ?? r.merma}%{l.merma == null ? ' (general)' : ''}</span></span><span>{l.qty} {i?.unit}</span></div>; })}</div>); })}
    {!!s.fabs.length && <><h3 style={{ marginTop: 18 }}>Últimas fabricaciones</h3>
      {[...s.fabs].reverse().slice(0, 10).map(f => <div className="row" key={f.id}>
        <span>{fecha(f.at)} · {s.recetas.find(r => r.id === f.rid)?.name ?? 'Receta eliminada'}</span><span>+{f.qty} · {money(f.costoU)} c/u{f.desc ? '' : ' (sin descontar)'}</span></div>)}</>}
  </div>);
}

export default function Page() {
  const [s, setS] = useState<S | null>(null); const [tab, setTab] = useState<keyof typeof SECC>('A'); const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { setS(seed()); }, []);
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(null), 3500); return () => clearTimeout(t); } }, [msg]);
  if (!s) return null;
  const act: Act = (fn, ok) => {
    const n = structuredClone(s); const e = fn(n);
    if (e) { setMsg({ k: 'err', t: e }); return false; }
    setS(n); setMsg({ k: 'ok', t: ok }); return true;
  };
  const h = new Date(), mes = pyl(s, d => d.getMonth() === h.getMonth() && d.getFullYear() === h.getFullYear());
  const { caja, banco } = saldos(s);
  const bajos = s.prods.filter(p => stk(s, p) < p.min).length + s.insumos.filter(i => i.stock < i.min).length;
  return (<div className="wrap">
    <div className="top"><div className="brand">🏢 {s.neg.nombre || <>Capital<b>+</b> PyMEs</>}</div>
      <span><span className="mut">🧪 Modo simulación: los datos no se guardan </span><button onClick={() => { setS({ ...seed(), neg: s.neg, cfg: s.cfg }); setMsg({ k: 'ok', t: 'Datos de ejemplo reiniciados.' }); }}>Reiniciar</button></span></div>
    <div className="kpis">
      <div className="kpi"><small>💵 Caja chica</small><strong>{money(caja)}</strong></div>
      <div className="kpi"><small>🏦 Bancos / Digital</small><strong>{money(banco)}</strong></div>
      <div className="kpi"><small>📦 Stock crítico</small><strong className={bajos ? 'neg' : ''}>{bajos}</strong></div>
      <div className="kpi"><small>📊 Resultado neto del mes</small><strong className={mes.neta < 0 ? 'neg' : 'pos'}>{money(mes.neta)}</strong></div></div>
    <div className="nav">{(Object.keys(SECC) as (keyof typeof SECC)[]).map(k => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{SECC[k]}</button>)}</div>
    {tab === 'A' && <ModA s={s} act={act} />}{tab === 'B' && <ModB s={s} act={act} />}{tab === 'F' && <Recetas s={s} act={act} />}{tab === 'C' && <ModC s={s} act={act} />}{tab === 'D' && <ModD s={s} />}{tab === 'E' && <Config s={s} act={act} />}
    {msg && <div className={'toast ' + (msg.k === 'err' ? 'err' : '')}>{msg.t}</div>}</div>);
}
