'use client';
// Guardar como app/IA.tsx (al lado de page.tsx)
import { useEffect, useRef, useState } from 'react';
import { S, guardarContenido, money, stk } from '../lib/engine';
import { Modo, Seo, contexto, snapshot, slugify } from '../lib/ia';

type Act = (fn: (n: S) => string | null, ok: string) => boolean;
const COL = { ok: '#3fb950', mid: '#d29922', bad: '#f85149', azul: '#58a6ff' };

// Un solo punto de entrada a la API. Devuelve el JSON o lanza Error con mensaje legible.
export async function llamarIA<T = Record<string, unknown>>(modo: Modo, s: S, payload: unknown): Promise<T> {
  const r = await fetch('/api/ia', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modo, negocio: s.neg.nombre, payload }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'No se pudo consultar a la IA.');
  return j as T;
}

/* ═════════ 1. Chat analítico flotante ═════════ */
const SUGERIDAS = ['¿Cómo cerró la caja hoy?', '¿Qué cliente nos compra más?', '¿Qué productos tengo que reponer?', '¿Cuánto tengo por cobrar y qué vence primero?', '¿Qué producto me deja más margen?'];
type Msg = { role: 'user' | 'assistant'; content: string };

export function ChatIA({ s }: { s: S }) {
  const [open, setOpen] = useState(false); const [msgs, setMsgs] = useState<Msg[]>([]);
  const [txt, setTxt] = useState(''); const [busy, setBusy] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  useEffect(() => { fin.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, busy, open]);

  const enviar = async (t: string) => {
    const q = t.trim(); if (!q || busy) return;
    const nuevos: Msg[] = [...msgs, { role: 'user', content: q }];
    setMsgs(nuevos); setTxt(''); setBusy(true);
    try {
      // el snapshot se recalcula en cada pregunta: siempre refleja el estado actual de la app
      const { texto } = await llamarIA<{ texto: string }>('chat', s, { mensajes: nuevos, snapshot: snapshot(s) });
      setMsgs([...nuevos, { role: 'assistant', content: texto }]);
    } catch (e) { setMsgs([...nuevos, { role: 'assistant', content: `⚠️ ${(e as Error).message}` }]); }
    setBusy(false);
  };

  if (!open) return <button className="p" onClick={() => setOpen(true)} title="Asistente IA"
    style={{ position: 'fixed', right: 18, bottom: 18, borderRadius: 999, padding: '12px 18px', zIndex: 50, boxShadow: '0 4px 14px rgba(0,0,0,.5)' }}>🤖 Asistente</button>;
  return (<div className="box" style={{ position: 'fixed', right: 18, bottom: 18, width: 'min(380px, calc(100vw - 36px))', height: 'min(560px, calc(100vh - 36px))',
    zIndex: 50, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 30px rgba(0,0,0,.6)' }}>
    <div className="row"><b>🤖 Asistente de {s.neg.nombre || 'tu negocio'}</b>
      <span><button onClick={() => setMsgs([])} title="Nueva conversación">🗑️</button> <button onClick={() => setOpen(false)}>✕</button></span></div>
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
      {!msgs.length && (<><p className="mut">Preguntame sobre ventas, caja, stock, clientes o cuentas pendientes. Solo leo los datos: no modifico nada.</p>
        <div className="pills">{SUGERIDAS.map(q => <button key={q} onClick={() => enviar(q)}>{q}</button>)}</div></>)}
      {msgs.map((m, i) => (<div key={i} style={{ margin: '8px 0', textAlign: m.role === 'user' ? 'right' : 'left' }}>
        <span style={{ display: 'inline-block', maxWidth: '88%', padding: '8px 12px', borderRadius: 12, whiteSpace: 'pre-wrap', textAlign: 'left',
          background: m.role === 'user' ? '#1f6feb' : '#21262d', color: '#e6edf3' }}>{m.content}</span></div>))}
      {busy && <p className="mut">Analizando tus datos…</p>}<div ref={fin} /></div>
    <div className="form" style={{ gridTemplateColumns: '1fr auto' }}>
      <input value={txt} placeholder="Escribí tu consulta…" onChange={e => setTxt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') enviar(txt); }} />
      <button className="p" disabled={busy || !txt.trim()} onClick={() => enviar(txt)}>Enviar</button></div></div>);
}

/* ═════════ 2 y 3. Productos y combos: copywriting + SEO ═════════ */
const CANALES = ['Instagram', 'Facebook', 'WhatsApp', 'MercadoLibre', 'Tienda Nube'];
const TONOS = ['cercano', 'divertido', 'premium', 'urgente (oferta)'];

function Editor({ s, act, id, onClose }: { s: S; act: Act; id: number; onClose: () => void }) {
  const p = s.prods.find(x => x.id === id)!;
  const [canal, setCanal] = useState(CANALES[0]); const [tono, setTono] = useState(TONOS[0]);
  const [rubro, setRubro] = useState(''); const [ciudad, setCiudad] = useState('');
  const [desc, setDesc] = useState(p.desc ?? '');
  const [seo, setSeo] = useState<Seo>(p.seo ?? { titulo: '', descripcion: '', keywords: [], slug: slugify(p.name) });
  const [busy, setBusy] = useState<'' | 'copy' | 'seo'>(''); const [err, setErr] = useState('');
  const go = async (k: 'copy' | 'seo') => {
    setBusy(k); setErr('');
    try {
      if (k === 'copy') setDesc((await llamarIA<{ texto: string }>('copy', s, { producto: contexto(s, p), canal, tono })).texto);
      else setSeo((await llamarIA<{ seo: Seo }>('seo', s, { producto: contexto(s, p), rubro, ciudad })).seo);
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  };
  const cnt = (v: string, max: number) => <small style={{ color: v.length > max ? COL.bad : '#8b949e' }}>{v.length}/{max}</small>;
  return (<div className="box" style={{ marginTop: 10, borderColor: COL.azul }}>
    <div className="row"><h3>✨ {p.combo ? '🎁 ' : ''}{p.name} · {money(p.price)}</h3><button onClick={onClose}>✕ Cerrar</button></div>
    {err && <p className="neg">⚠️ {err}</p>}
    <h3>Descripción comercial</h3>
    <div className="form">
      <label>Canal<select value={canal} onChange={e => setCanal(e.target.value)}>{CANALES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Tono<select value={tono} onChange={e => setTono(e.target.value)}>{TONOS.map(c => <option key={c}>{c}</option>)}</select></label></div>
    <div className="pills"><button className="p" disabled={!!busy} onClick={() => go('copy')}>{busy === 'copy' ? 'Redactando…' : '✨ Generar con IA'}</button>
      {desc && <button onClick={() => navigator.clipboard?.writeText(desc)}>📋 Copiar</button>}</div>
    <textarea rows={6} style={{ width: '100%' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Acá aparece el texto. Podés editarlo antes de guardar." />
    <p className="mut">La IA usa el precio y tu margen de maniobra para decidir si conviene sugerir una promo, pero nunca muestra costo ni margen en el texto.</p>

    <h3>SEO para el catálogo online</h3>
    <div className="form">
      <label>Rubro (opcional)<input value={rubro} onChange={e => setRubro(e.target.value)} placeholder="Ej: panadería artesanal" /></label>
      <label>Ciudad / zona (opcional)<input value={ciudad} onChange={e => setCiudad(e.target.value)} placeholder="Ej: Río Tercero, Córdoba" /></label></div>
    <div className="pills"><button className="p" disabled={!!busy} onClick={() => go('seo')}>{busy === 'seo' ? 'Optimizando…' : '🔎 Sugerir SEO con IA'}</button></div>
    <div className="form">
      <label>Título SEO {cnt(seo.titulo, 60)}<input value={seo.titulo} onChange={e => setSeo({ ...seo, titulo: e.target.value })} /></label>
      <label>Meta descripción {cnt(seo.descripcion, 155)}<input value={seo.descripcion} onChange={e => setSeo({ ...seo, descripcion: e.target.value })} /></label>
      <label>Palabras clave (separadas por coma)<input value={seo.keywords.join(', ')} onChange={e => setSeo({ ...seo, keywords: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} /></label>
      <label>Slug (URL)<input value={seo.slug} onChange={e => setSeo({ ...seo, slug: slugify(e.target.value) })} /></label></div>
    <div style={{ border: '1px solid #30363d', borderRadius: 8, padding: '8px 12px', margin: '8px 0' }}>
      <small className="mut">Vista previa en Google</small>
      <div style={{ color: '#8ab4f8', fontSize: 18 }}>{seo.titulo || p.name}</div>
      <div style={{ color: '#3fb950', fontSize: 12 }}>tutienda.com/productos/{seo.slug || slugify(p.name)}</div>
      <div style={{ color: '#bdc1c6', fontSize: 13 }}>{seo.descripcion || 'Sin meta descripción todavía.'}</div></div>
    <button className="p" onClick={() => { if (act(n => guardarContenido(n, id, desc.trim(), seo), `Contenido de «${p.name}» guardado.`)) onClose(); }}>💾 Guardar en el producto</button></div>);
}

export function CatalogoIA({ s, act }: { s: S; act: Act }) {
  const [id, setId] = useState(0);
  return (<div className="box" style={{ marginTop: 14 }}><h3>✨ Contenido comercial y SEO (IA)</h3>
    <p className="mut">Generá textos para redes y e-commerce y los metadatos para buscadores. Todo es editable antes de guardar. Incluye combos.</p>
    <div className="scroll"><table><thead><tr><th>Producto</th><th>Precio</th><th>Stock</th><th>Descripción</th><th>SEO</th><th></th></tr></thead><tbody>
      {s.prods.map(p => (<tr key={p.id}><td>{p.combo ? '🎁 ' : ''}{p.name}</td><td>{money(p.price)}</td><td>{stk(s, p)}</td>
        <td>{p.desc ? '✅' : '—'}</td><td>{p.seo?.titulo ? '✅' : '—'}</td>
        <td><button className="p" onClick={() => setId(id === p.id ? 0 : p.id)}>✨ Generar con IA</button></td></tr>))}</tbody></table></div>
    {id > 0 && <Editor key={id} s={s} act={act} id={id} onClose={() => setId(0)} />}</div>);
}

/* ═════════ 2b. Reactivación: variantes de mensaje con IA (se enchufa en Marketing.tsx → Reactivacion) ═════════ */
export function RedactorReactivacion({ s, oferta, onPick }: { s: S; oferta: number; onPick: (plantilla: string) => void }) {
  const [vars, setVars] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [tono, setTono] = useState('cálido');
  const gen = async () => {
    setBusy(true); setErr('');
    const top = [...s.prods].filter(p => !p.combo).slice(0, 5).map(p => p.name);
    try { setVars((await llamarIA<{ variantes: string[] }>('reactivacion', s, { oferta, tono, cantidad: undefined, productos: top })).variantes); }
    catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (<div className="box" style={{ margin: '8px 0', borderColor: COL.azul }}>
    <div className="pills"><b>✨ Redactar con IA</b>
      <select value={tono} onChange={e => setTono(e.target.value)}>{['cálido', 'divertido', 'formal', 'directo'].map(t => <option key={t}>{t}</option>)}</select>
      <button className="p" disabled={busy} onClick={gen}>{busy ? 'Redactando…' : 'Generar 3 variantes'}</button></div>
    {err && <p className="neg">⚠️ {err}</p>}
    {vars.map((v, i) => (<div className="row" key={i}><span className="mut">{v}</span><button onClick={() => onPick(v)}>Usar esta</button></div>))}
    {!!vars.length && <p className="mut">Las variantes conservan {'{nombre} {dias} {oferta} {negocio}'}: se completan solas para cada cliente. Al elegir una, queda como plantilla del mensaje.</p>}</div>);
}
