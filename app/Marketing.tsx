'use client';
// Guardar como app/Marketing.tsx (al lado de page.tsx, Extras.tsx y Extras2.tsx)
import { useState } from 'react';
import { Aviso, Cfg, Contacto, PLANTILLA_REACT, Prod, S, avisos, descuentos, diasSinComprar, inactivos, marcarEnviado, mensaje, money, proxCumple, puntosDe, puntosGanados, sugerencias } from '../lib/engine';
import { RedactorReactivacion } from './IA';

type Act = (fn: (n: S) => string | null, ok: string) => boolean;
const COL = { ok: '#3fb950', mid: '#d29922', bad: '#f85149', azul: '#58a6ff' };
const chk = { flexDirection: 'row', alignItems: 'center', gap: 6, color: '#e6edf3' } as const;
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const fh = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });

/* ── utilidades de envío (sin backend: abre WhatsApp / correo del dispositivo) ── */
const telWa = (x: string) => { let d = x.replace(/\D/g, '').replace(/^0+/, ''); if (!d) return ''; if (!d.startsWith('54')) d = '549' + d.replace(/^15/, ''); return d; }; // supone celulares de Argentina
const urlWa = (c: Contacto, t: string) => (telWa(c.tel) ? `https://wa.me/${telWa(c.tel)}?text=${encodeURIComponent(t)}` : '');
const urlMail = (c: Contacto, asunto: string, t: string) => (c.email ? `mailto:${c.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(t)}` : '');
const csv = (rows: string[][]) => '\ufeff' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n');
const bajar = (nombre: string, txt: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })); a.download = nombre; a.click(); URL.revokeObjectURL(a.href); };

/* ═════════ 1 · Ficha del cliente: puntos, última compra, cumpleaños ═════════ */
export function FichaMkt({ s, c }: { s: S; c: Contacto }) {
  const d = diasSinComprar(s, c.id), pc = proxCumple(c);
  return (<p className="mut">
    {s.cfg.fid.activo && <>⭐ <b style={{ color: COL.mid }}>{puntosDe(s, c.id)} puntos</b> (valen {money(puntosDe(s, c.id) * s.cfg.fid.valor)}) · </>}
    🛒 {d == null ? 'sin compras' : d === 0 ? 'compró hoy' : `última compra hace ${d} día(s)`}
    {c.cumple && <> · 🎂 {pc === 0 ? 'cumple HOY' : `cumple en ${pc} día(s)`}</>}</p>);
}

/* ═════════ 1 · Canje de puntos en la Registradora ═════════ */
export function CanjePuntos({ s, cid, canje, setCanje, maxPts, total }: { s: S; cid: number; canje: number; setCanje: (n: number) => void; maxPts: number; total: number }) {
  const f = s.cfg.fid;
  if (!f.activo || !cid) return null;
  const saldo = puntosDe(s, cid);
  return (<div className="box" style={{ margin: '8px 0', borderColor: COL.mid }}>
    <div className="row"><b>⭐ Puntos del cliente: {saldo}</b><span className="mut">1 punto = {money(f.valor)}</span></div>
    {maxPts <= 0
      ? <p className="mut">{saldo > 0 ? 'Con el total actual no se pueden canjear puntos.' : 'Todavía no tiene puntos para canjear.'}</p>
      : (<div className="form">
        <label>Puntos a canjear (máx. {maxPts})<input type="number" min={0} max={maxPts} value={canje || ''} placeholder="0" onChange={e => setCanje(Math.max(0, Math.min(maxPts, Math.floor(+e.target.value || 0))))} /></label>
        <div style={{ alignSelf: 'end' }} className="pills"><button onClick={() => setCanje(maxPts)}>Usar máximo</button>{canje > 0 && <button onClick={() => setCanje(0)}>Quitar</button>}</div></div>)}
    {canje > 0 && <p className="pos">Descuento por puntos: −{money(canje * f.valor)}</p>}
    <p className="mut">Con esta compra va a sumar +{puntosGanados(s, total)} puntos.</p></div>);
}

/* ═════════ 2 · Sugerencias de venta cruzada ═════════ */
export function Sugerencias({ s, cart, cid, onAdd }: { s: S; cart: Record<number, number>; cid: number; onAdd: (pid: number) => void }) {
  const l = sugerencias(s, Object.keys(cart).map(Number), cid);
  const cli = s.contactos.find(c => c.id === cid);
  if (!l.length) return null;
  return (<div className="box" style={{ margin: '8px 0', borderColor: COL.azul }}><b>💡 Sugerencias para este ticket</b>
    {l.map(x => (<div className="row" key={x.p.id}>
      <span>{x.tipo === 'cli' && cli ? `A ${cli.name} le suele gustar acompañarlo con ` : x.tipo === 'fav' && cli ? `${cli.name} suele comprar ` : 'Se suele llevar junto con '}
        <b>{x.p.name}</b> <span className="mut">· {money(x.p.price)} · {x.motivo}</span></span>
      <button className="p" onClick={() => onAdd(x.p.id)}>➕ Agregar</button></div>))}</div>);
}

/* ═════════ 3 y 4 · CRM: campañas automáticas y reactivación ═════════ */
function Automaticas({ s, act }: { s: S; act: Act }) {
  const lista = avisos(s);
  const enviar = (a: Aviso, via: 'wa' | 'mail' | 'ya') => {
    const c = s.contactos.find(x => x.id === a.cid)!, t = mensaje(s, a);
    const url = via === 'wa' ? urlWa(c, t) : via === 'mail' ? urlMail(c, a.tipo === 'CUMPLE' ? '¡Feliz cumpleaños!' : 'Te estamos esperando', t) : '';
    if (via !== 'ya' && !url) { act(() => `${c.name} no tiene ${via === 'wa' ? 'teléfono' : 'email'} cargado.`, ''); return; }
    if (url) window.open(url, '_blank');
    act(n => marcarEnviado(n, [{ cid: a.cid, tipo: a.tipo, ref: a.ref }]), via === 'ya' ? 'Marcado como enviado.' : `Mensaje para ${c.name} abierto y registrado como enviado.`);
  };
  const grupos: [Aviso['tipo'], string][] = [['CUMPLE', '🎂 Cumpleaños'], ['RECOMPRA', '🔁 Aviso de recompra']];
  return (<div>
    <p className="mut">El sistema detecta solo a quién avisar. Cumpleaños: dentro de los próximos {s.cfg.camp.diasCumple} días (si cargaste la fecha en la ficha). Recompra: productos que el cliente compró {s.cfg.camp.minCompras}+ veces y no lleva hace {s.cfg.camp.diasRecompra}+ días. Los umbrales se cambian en Configuración.</p>
    {grupos.map(([tipo, titulo]) => { const l = lista.filter(a => a.tipo === tipo); return (<div key={tipo}>
      <h3>{titulo} ({l.length})</h3>
      {!l.length && <p className="mut">Nada pendiente. 🎉</p>}
      {l.map(a => { const c = s.contactos.find(x => x.id === a.cid)!; return (<div className="row" key={a.cid + a.ref}>
        <span><b>{c.name}</b>{a.tipo === 'CUMPLE' && <span className="mut"> · {a.dias === 0 ? 'cumple hoy' : `cumple en ${a.dias} día(s)`}</span>}<br /><span className="mut">{mensaje(s, a)}</span></span>
        <span className="pills"><button className="p" onClick={() => enviar(a, 'wa')}>💬 WhatsApp</button><button onClick={() => enviar(a, 'mail')}>✉️ Email</button><button onClick={() => enviar(a, 'ya')}>✓ Ya enviado</button></span></div>); })}</div>); })}
    {!!s.envios.length && <><h3>Últimos envíos</h3>{[...s.envios].reverse().slice(0, 5).map(e => (<div className="row" key={e.id}>
      <span>{s.contactos.find(c => c.id === e.cid)?.name}</span><span className="mut">{e.tipo === 'CUMPLE' ? 'Cumpleaños' : e.tipo === 'RECOMPRA' ? 'Recompra' : 'Reactivación'} · {fh(e.at)}</span></div>))}</>}</div>);
}

function Reactivacion({ s, act }: { s: S; act: Act }) {
  const [dias, setDias] = useState(s.cfg.camp.diasInactivo); const [oferta, setOferta] = useState(s.cfg.camp.ofertaPct);
  const [plantilla, setPl] = useState(PLANTILLA_REACT); const [sel, setSel] = useState<number[]>([]);
  const l = inactivos(s, dias), todos = l.length > 0 && l.every(x => sel.includes(x.c.id)), elegidos = l.filter(x => sel.includes(x.c.id));
  const msg = (x: { c: Contacto; d: number }) => mensaje(s, { cid: x.c.id, tipo: 'REACT', ref: '', dias: x.d }, oferta, plantilla);
  const ref = (x: { c: Contacto }) => (s.contactos.length ? (s.txs.filter(t => t.cid === x.c.id && !t.void && t.type === 'SALE').map(t => t.at).sort().pop() ?? '') : '');
  const contactado = (x: { c: Contacto }) => s.envios.find(e => e.cid === x.c.id && e.tipo === 'REACT' && e.ref === ref(x));
  const marcar = (xs: typeof l, ok: string) => act(n => marcarEnviado(n, xs.map(x => ({ cid: x.c.id, tipo: 'REACT' as const, ref: ref(x) }))), ok);
  const copiar = () => { navigator.clipboard?.writeText(elegidos.map(x => `${x.c.name}${x.c.tel ? ` (${x.c.tel})` : ''}:\n${msg(x)}`).join('\n\n')); act(() => null, `${elegidos.length} mensaje(s) copiados al portapapeles.`); };
  const exportar = () => bajar(`reactivacion_${dias}d.csv`, csv([['Cliente', 'Teléfono', 'Email', 'Días sin comprar', 'Última compra', 'Total histórico', 'Mensaje'],
    ...elegidos.map(x => [x.c.name, x.c.tel, x.c.email, String(x.d), ref(x) ? fh(ref(x)) : '', String(Math.round(x.gastado)), msg(x)])]));
  const wa1 = (x: (typeof l)[number]) => { const u = urlWa(x.c, msg(x)); if (!u) { act(() => `${x.c.name} no tiene teléfono cargado.`, ''); return; } window.open(u, '_blank'); marcar([x], `Mensaje para ${x.c.name} abierto y registrado.`); };
  const mailMasivo = () => { const mails = elegidos.filter(x => x.c.email).map(x => x.c.email); if (!mails.length) { act(() => 'Ningún cliente seleccionado tiene email.', ''); return; }
    window.open(`mailto:?bcc=${encodeURIComponent(mails.join(','))}&subject=${encodeURIComponent('Te extrañamos 💙')}&body=${encodeURIComponent(msg(elegidos[0]).replace(elegidos[0].c.name, 'cliente'))}`, '_blank'); };
  return (<div>
    <p className="mut">Clientes con compras registradas que dejaron de venir. Elegí el período, seleccionalos y generá el mensaje de relanzamiento con tu oferta.</p>
    <div className="pills">{[60, 90].map(n => <button key={n} className={dias === n ? 'on' : ''} onClick={() => { setDias(n); setSel([]); }}>😴 {n}+ días sin comprar</button>)}</div>
    <div className="kpis">
      <div className="kpi"><small>Clientes inactivos</small><strong className={l.length ? 'neg' : 'pos'}>{l.length}</strong></div>
      <div className="kpi"><small>Compraron históricamente</small><strong>{money(l.reduce((a, x) => a + x.gastado, 0))}</strong></div>
      <div className="kpi"><small>Seleccionados</small><strong>{elegidos.length}</strong></div></div>
    <div className="form">
      <label>Oferta de relanzamiento %<input type="number" min={0} max={90} value={oferta} onChange={e => setOferta(+e.target.value)} /></label>
      <label>Mensaje ({'{nombre} {dias} {oferta} {negocio}'})<input value={plantilla} onChange={e => setPl(e.target.value)} /></label></div>
    <p className="mut">La oferta se concreta en la Registradora con el campo «Descuento %» al momento de la compra.</p>
    <RedactorReactivacion s={s} oferta={oferta} onPick={setPl} />
    {!l.length ? <p className="mut">No hay clientes con {dias}+ días sin comprar. 🎉</p> : (<>
      <div className="pills">
        <button onClick={() => setSel(todos ? [] : l.map(x => x.c.id))}>{todos ? 'Quitar selección' : '☑ Seleccionar todos'}</button>
        <button className="p" disabled={!elegidos.length} onClick={copiar}>📋 Copiar mensajes</button>
        <button disabled={!elegidos.length} onClick={exportar}>⬇️ Reporte CSV</button>
        <button disabled={!elegidos.length} onClick={mailMasivo}>✉️ Email masivo (CCO)</button>
        <button disabled={!elegidos.length} onClick={() => marcar(elegidos, `${elegidos.length} cliente(s) marcados como contactados.`)}>✓ Marcar contactados</button></div>
      <div className="scroll"><table><thead><tr><th></th><th>Cliente</th><th>Contacto</th><th>Días sin comprar</th><th>Total histórico</th><th>Estado</th><th></th></tr></thead><tbody>
        {l.map(x => { const ct = contactado(x); return (<tr key={x.c.id}>
          <td><input type="checkbox" style={{ width: 'auto' }} checked={sel.includes(x.c.id)} onChange={e => setSel(e.target.checked ? [...sel, x.c.id] : sel.filter(i => i !== x.c.id))} /></td>
          <td style={{ textAlign: 'left' }}>{x.c.name}</td><td>{x.c.tel || x.c.email || 's/d'}</td>
          <td className={x.d >= 90 ? 'neg' : ''}>{x.d}</td><td>{money(x.gastado)}</td>
          <td>{ct ? `✓ contactado ${fh(ct.at)}` : '—'}</td><td><button onClick={() => wa1(x)}>💬 WhatsApp</button></td></tr>); })}</tbody></table></div></>)}</div>);
}

export function MarketingCRM({ s, act }: { s: S; act: Act }) {
  const [v, setV] = useState<'auto' | 'ina'>('auto');
  const n = avisos(s).length, ni = inactivos(s, s.cfg.camp.diasInactivo).length;
  return (<div className="box" style={{ marginTop: 10 }}><h3>📣 Marketing y fidelización</h3>
    <div className="pills">
      <button className={v === 'auto' ? 'on' : ''} onClick={() => setV('auto')}>🤖 Mensajes automáticos ({n})</button>
      <button className={v === 'ina' ? 'on' : ''} onClick={() => setV('ina')}>😴 Clientes inactivos ({ni})</button></div>
    {v === 'auto' ? <Automaticas s={s} act={act} /> : <Reactivacion s={s} act={act} />}</div>);
}

/* ═════════ Configuración: puntos, Happy Hour y parámetros de campañas ═════════ */
export function ConfigMkt({ c, ed, prods }: { c: Cfg; ed: (f: (d: Cfg) => void) => void; prods: Prod[] }) {
  const num = (l: string, v: number, f: (d: Cfg, x: number) => void) => <label>{l}<input type="number" min={0} value={v} onChange={e => ed(d => f(d, +e.target.value))} /></label>;
  const f = c.fid;
  return (<>
    <h3>⭐ Fidelización por puntos</h3>
    <label style={chk}><input type="checkbox" style={{ width: 'auto' }} checked={f.activo} onChange={e => ed(d => { d.fid.activo = e.target.checked; })} />Activar sistema de puntos</label>
    <div className="form">{num('1 punto cada $', f.pesos, (d, x) => { d.fid.pesos = x; })}{num('Cada punto canjea $', f.valor, (d, x) => { d.fid.valor = x; })}</div>
    <p className="mut">Con esta regla cada compra devuelve ≈ {f.pesos > 0 ? (f.valor / f.pesos * 100).toFixed(1) : 0}% en descuentos. Suman las ventas pagadas (el fiado, al cobrarse) y se revierten al anular la venta.</p>

    <h3>🕕 Descuentos por franja horaria (Happy Hour)</h3>
    {!c.happy.length && <p className="mut">No hay reglas. Agregá una para aplicar descuentos automáticos en la Registradora.</p>}
    {c.happy.map((r, i) => (<div className="box" key={r.id} style={{ marginTop: 8 }}>
      <div className="form">
        <label>Nombre<input value={r.name} onChange={e => ed(d => { d.happy[i].name = e.target.value; })} /></label>
        {num('% de descuento', r.pct, (d, x) => { d.happy[i].pct = x; })}
        <label>Desde<input type="time" value={r.desde} onChange={e => ed(d => { d.happy[i].desde = e.target.value; })} /></label>
        <label>Hasta<input type="time" value={r.hasta} onChange={e => ed(d => { d.happy[i].hasta = e.target.value; })} /></label>
        <div style={{ alignSelf: 'end' }}><button onClick={() => ed(d => { d.happy.splice(i, 1); })}>✕</button></div></div>
      <div className="pills">
        {[1, 2, 3, 4, 5, 6, 0].map(k => <button key={k} className={r.dias.includes(k) ? 'on' : ''}
          onClick={() => ed(d => { const a = d.happy[i].dias; d.happy[i].dias = a.includes(k) ? a.filter(x => x !== k) : [...a, k]; })}>{DIAS[k]}</button>)}
        <label style={chk}><input type="checkbox" style={{ width: 'auto' }} checked={r.activo} onChange={e => ed(d => { d.happy[i].activo = e.target.checked; })} />Regla activa</label></div>
      <details><summary>Productos incluidos: {r.pids.length ? `${r.pids.length} seleccionado(s)` : 'todos'}</summary>
        <div className="pills">{prods.filter(p => !p.combo).map(p => (<label key={p.id} style={chk}><input type="checkbox" style={{ width: 'auto' }} checked={r.pids.includes(p.id)}
          onChange={e => ed(d => { const a = d.happy[i].pids; d.happy[i].pids = e.target.checked ? [...a, p.id] : a.filter(x => x !== p.id); })} />{p.name}</label>))}</div>
        <p className="mut">Sin ningún producto tildado, la regla aplica a todo el catálogo.</p></details></div>))}
    <div className="pills"><button onClick={() => ed(d => { d.happy.push({ id: Math.max(0, ...d.happy.map(x => x.id)) + 1, name: 'Happy Hour', activo: true, dias: [1, 2, 3, 4, 5], desde: '18:00', hasta: '20:00', pct: 20, pids: [] }); })}>➕ Agregar regla</button></div>
    <p className="mut">Se evalúa con la hora de la venta. Si varias reglas coinciden en un producto, gana el mayor %. El descuento sale en el ticket y se suma a «Descuentos» del estado de resultados.</p>

    <h3>📣 Parámetros de campañas</h3>
    <div className="form">{num('Avisar cumpleaños con (días de anticipación)', c.camp.diasCumple, (d, x) => { d.camp.diasCumple = x; })}
      {num('Recompra: avisar tras (días sin comprarlo)', c.camp.diasRecompra, (d, x) => { d.camp.diasRecompra = x; })}
      {num('Producto frecuente = comprado al menos (veces)', c.camp.minCompras, (d, x) => { d.camp.minCompras = x; })}
      {num('Cliente inactivo desde (días)', c.camp.diasInactivo, (d, x) => { d.camp.diasInactivo = x; })}
      {num('Oferta de relanzamiento %', c.camp.ofertaPct, (d, x) => { d.camp.ofertaPct = x; })}</div>
  </>);
}
