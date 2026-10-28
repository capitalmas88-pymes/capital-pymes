'use client';
// Guardar como app/Extras.tsx (al lado de page.tsx)
import { useState } from 'react';
import { S, abierta, abrir, actualizarInicial, anularMov, calcPrecio, cerrar, eliminarCombo, esperado, money, movimiento, nuevoCombo, selDefault, stk, turnoActual } from '../lib/engine';

type Act = (fn: (n: S) => string | null, ok: string) => boolean;
const fh = (iso: string) => new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const cuentas = (s: S) => s.medios.filter(m => m.tipo !== 'credito').map(m => m.name);
const ultCerrado = (s: S) => [...s.turnos].reverse().find(x => x.cierra);

export function EstadoCaja({ s }: { s: S }) {
  const a = abierta(s), t = turnoActual(s);
  return <b className={a ? 'pos' : 'neg'}>{a ? '🔓 Caja abierta' : '🔒 Caja cerrada'}{a && t ? ` desde ${fh(t.abre)}` : ''}</b>;
}

function Montos({ ms, v, set }: { ms: string[]; v: Record<string, number>; set: (x: Record<string, number>) => void }) {
  return (<div className="form">{ms.map(m => (
    <label key={m}>{m}<input type="number" min={0} value={v[m] ?? 0} onChange={e => set({ ...v, [m]: +e.target.value })} /></label>))}</div>);
}

/* ───────── APERTURA ───────── */
export function Apertura({ s, act }: { s: S; act: Act }) {
  const ms = cuentas(s), t = turnoActual(s), ab = abierta(s), ult = ultCerrado(s);
  const [v, setV] = useState<Record<string, number>>(() => (ab && t ? { ...t.inicial } : { ...(ult?.contado ?? {}) }));
  const [nota, setNota] = useState('');
  if (ab && t) return (<div className="box">
    <h3>🔓 Caja abierta</h3>
    <p className="mut">Turno #{t.id} abierto el {fh(t.abre)}{t.nota ? ` — ${t.nota}` : ''}.</p>
    <h3>Actualizar saldos iniciales</h3>
    <Montos ms={ms} v={v} set={setV} />
    <button className="p" onClick={() => act(n => actualizarInicial(n, v), 'Saldos iniciales actualizados.')}>Guardar saldos iniciales</button>
    <p className="mut">Corrige lo que había al abrir el turno. Los movimientos y ventas ya registrados se mantienen.</p></div>);
  return (<div className="box">
    <h3>🔒 Caja cerrada</h3>
    <p className="mut">Reabrila para continuar operando. Podés abrir y cerrar todas las veces que necesites en el día.</p>
    <h3>{s.turnos.length ? 'Reabrir caja' : 'Abrir caja'}</h3>
    <Montos ms={ms} v={v} set={setV} />
    <div className="form"><label>{s.turnos.length ? 'Motivo de la reapertura' : 'Nota (opcional)'}
      <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: faltó registrar una venta, ajuste de diferencia…" /></label></div>
    <button className="p" onClick={() => act(n => abrir(n, v, nota.trim()), 'Caja abierta.')}>{s.turnos.length ? '🔄 Reabrir caja' : '🔓 Abrir caja'}</button>
    {ult && <p className="mut">Los saldos se completaron con lo contado en el último cierre ({fh(ult.cierra!)}). Podés cambiarlos.</p>}</div>);
}

/* ───────── CIERRE ───────── */
export function Cierre({ s, act }: { s: S; act: Act }) {
  const ms = cuentas(s), t = turnoActual(s), ab = abierta(s);
  const [cont, setCont] = useState<Record<string, number>>({}); const [nota, setNota] = useState('');
  if (!ab || !t) {
    const u = ultCerrado(s);
    return (<div className="box"><h3>🔒 Caja cerrada</h3>
      {!u ? <p className="mut">Todavía no cerraste ningún turno.</p> : (<>
        <p className="mut">Último cierre: turno #{u.id}, {fh(u.cierra!)}{u.cierreNota ? ` — ${u.cierreNota}` : ''}</p>
        <div className="scroll"><table><thead><tr><th>Medio</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody>
          {ms.map(m => { const d = (u.contado?.[m] ?? 0) - (u.esperado?.[m] ?? 0); return (<tr key={m}>
            <td>{m}</td><td>{money(u.inicial[m] ?? 0)}</td><td>{money(u.esperado?.[m] ?? 0)}</td><td>{money(u.contado?.[m] ?? 0)}</td>
            <td className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{money(d)}</td></tr>); })}</tbody></table></div></>)}</div>);
  }
  const esp = esperado(s, t);
  const val = (m: string) => cont[m] ?? Math.round(esp[m]);
  return (<div className="box"><h3>🔒 Cierre de caja · turno #{t.id}</h3>
    <p className="mut">Contá lo que hay en cada medio y compará con lo que el sistema espera (saldo inicial + cobros − pagos ± movimientos).</p>
    <div className="scroll"><table><thead><tr><th>Medio</th><th>Inicial</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody>
      {ms.map(m => { const d = val(m) - esp[m]; return (<tr key={m}>
        <td>{m}</td><td>{money(t.inicial[m] ?? 0)}</td><td>{money(esp[m])}</td>
        <td><input type="number" style={{ width: 120 }} value={val(m)} onChange={e => setCont({ ...cont, [m]: +e.target.value })} /></td>
        <td className={Math.abs(d) < .5 ? '' : d < 0 ? 'neg' : 'pos'}>{money(d)}</td></tr>); })}</tbody></table></div>
    <div className="form"><label>Observaciones<input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: faltante de $500 en efectivo" /></label></div>
    <button className="p" onClick={() => act(n => cerrar(n, Object.fromEntries(ms.map(m => [m, val(m)])), nota.trim()), 'Caja cerrada.')}>🔒 Cerrar caja</button></div>);
}

/* ───────── MOVIMIENTOS (ingresos / retiros manuales) ───────── */
export function Movs({ s, act }: { s: S; act: Act }) {
  const ms = cuentas(s), t = turnoActual(s), ab = abierta(s);
  const [tipo, setT] = useState<'IN' | 'OUT'>('OUT'); const [medio, setM] = useState(ms[0]);
  const [monto, setMonto] = useState(0); const [desc, setD] = useState('');
  const lista = [...s.movs].reverse();
  return (<div className="box"><h3>💱 Movimientos de caja</h3>
    {!ab && <p className="neg">La caja está cerrada. Abrila para registrar movimientos.</p>}
    <div className="form">
      <label>Tipo<select value={tipo} onChange={e => setT(e.target.value as 'IN' | 'OUT')}><option value="IN">Ingreso (pone plata)</option><option value="OUT">Retiro (saca plata)</option></select></label>
      <label>Medio<select value={medio} onChange={e => setM(e.target.value)}>{ms.map(m => <option key={m}>{m}</option>)}</select></label>
      <label>Monto<input type="number" min={0} value={monto} onChange={e => setMonto(+e.target.value)} /></label>
      <label>Motivo<input value={desc} onChange={e => setD(e.target.value)} placeholder="Ej: cambio, retiro del dueño, depósito…" /></label></div>
    <button className="p" disabled={!ab} onClick={() => { if (act(n => movimiento(n, tipo, medio, monto, desc), 'Movimiento registrado.')) { setMonto(0); setD(''); } }}>Registrar movimiento</button>
    <h3 style={{ marginTop: 18 }}>Historial</h3>
    {!lista.length ? <p className="mut">Todavía no hay movimientos.</p> : (
      <div className="scroll"><table><thead><tr><th>#</th><th>Turno</th><th>Fecha</th><th>Medio</th><th>Motivo</th><th>Monto</th><th></th></tr></thead><tbody>
        {lista.map(m => (<tr key={m.id} style={m.void ? { opacity: .45 } : undefined}>
          <td>{m.id}</td><td>#{m.turno}</td><td>{fh(m.at)}</td><td>{m.medio}</td><td style={{ textAlign: 'left' }}>{m.desc}</td>
          <td className={m.tipo === 'IN' ? 'pos' : 'neg'}>{m.tipo === 'IN' ? '+' : '−'}{money(m.monto)}</td>
          <td>{!m.void && ab && t && m.turno === t.id ? <button onClick={() => act(n => anularMov(n, m.id), 'Movimiento anulado.')}>Anular</button> : m.void ? '❌' : ''}</td></tr>))}</tbody></table></div>)}</div>);
}

/* ───────── COMBOS / OFERTAS ───────── */
export function Combos({ s, act }: { s: S; act: Act }) {
  const [q, setQ] = useState(''); const [it, setIt] = useState<{ pid: number; qty: number }[]>([]);
  const [name, setName] = useState(''); const [notes, setNotes] = useState(''); const [price, setPrice] = useState(0);
  const prod = (id: number) => s.prods.find(p => p.id === id);
  const base = s.prods.filter(p => !p.combo && p.name.toLowerCase().includes(q.toLowerCase()));
  const cost = it.reduce((a, l) => a + l.qty * (prod(l.pid)?.cost ?? 0), 0);
  const sug = cost > 0 ? calcPrecio(cost, s.cfg.mv, s.cfg, selDefault)?.lista : undefined;
  const add = (pid: number, d: number) => {
    const n = [...it], i = n.findIndex(x => x.pid === pid);
    if (i < 0) { if (d > 0) n.push({ pid, qty: d }); } else { n[i] = { ...n[i], qty: n[i].qty + d }; if (n[i].qty <= 0) n.splice(i, 1); }
    setIt(n);
  };
  const combos = s.prods.filter(p => p.combo);
  return (<div className="box" style={{ marginTop: 14 }}><h3>🎁 Armador de combos y ofertas</h3>
    <div className="grid">
      <div>
        <h3>Productos del stock</h3>
        <label>Buscar producto<input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" /></label>
        {base.map(p => (<div className="row" key={p.id}><span>{p.name}</span><span>{money(p.cost)} <button onClick={() => add(p.id, 1)}>+ Agregar</button></span></div>))}
        <h3 style={{ marginTop: 14 }}>Productos del combo</h3>
        {!it.length && <p className="mut">Agregá productos desde arriba.</p>}
        {it.map(l => (<div className="row" key={l.pid}><span><b>{l.qty}×</b> {prod(l.pid)?.name}</span>
          <span>{money(l.qty * (prod(l.pid)?.cost ?? 0))} <button onClick={() => add(l.pid, -1)}>−</button> <button onClick={() => add(l.pid, 1)}>+</button>
            <button onClick={() => setIt(it.filter(x => x.pid !== l.pid))}>✕</button></span></div>))}
      </div>
      <div>
        <div className="kpi"><small>Costo total del combo</small><strong>{money(cost)}</strong>
          {sug && <small>Precio sugerido (margen {s.cfg.mv}%): {money(sug)}</small>}</div>
        <h3 style={{ marginTop: 14 }}>Guardar combo</h3>
        <div className="form">
          <label>Nombre del combo<input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Kit Cumpleaños, Pack Verano…" /></label>
          <label>Precio de venta (0 = usar el sugerido)<input type="number" min={0} value={price} onChange={e => setPrice(+e.target.value)} /></label>
          <label>Notas (opcional)<input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Descripción, temporada, objetivo…" /></label></div>
        <button className="p" disabled={!it.length} onClick={() => { if (act(n => nuevoCombo(n, name, notes, it, price), `Combo «${name.trim()}» guardado.`)) { setIt([]); setName(''); setNotes(''); setPrice(0); } }}>💾 Guardar combo → Stock</button>
        <p className="mut">El combo queda en el inventario como un producto más: se vende desde la registradora y descuenta el stock de cada componente.</p>
        <h3 style={{ marginTop: 14 }}>Combos guardados</h3>
        {!combos.length && <p className="mut">Todavía no hay combos.</p>}
        {combos.map(c => (<div className="row" key={c.id}><span><b>🎁 {c.name}</b><br />
          <span className="mut">Costo {money(c.cost)} · Precio {money(c.price)} · Disponibles {stk(s, c)}</span><br />
          <span className="mut">{c.combo!.map(x => `${prod(x.pid)?.name ?? '?'} ×${x.qty}`).join(', ')}{c.notes ? ` — ${c.notes}` : ''}</span></span>
          <button onClick={() => act(n => eliminarCombo(n, c.id), `Combo «${c.name}» eliminado.`)}>Eliminar</button></div>))}
      </div></div></div>);
}
