import type { SupabaseClient } from '@supabase/supabase-js';
import { CUOTAS, cfgDefault } from './engine';
import type { Cfg, Contacto, Envio, Fab, Insumo, Medio, Mov, Prod, Receta, S, Tipo, Turno, Tx } from './engine';

/* ═════════════════════════════════════════════════════════════════════════
   Puente entre engine.ts (estado en memoria) y Supabase.

   · cargar()  → lee todas las tablas del negocio y arma el objeto S que ya usa toda la app.
   · guardar() → compara el S de antes con el de después de una operación y manda SOLO lo que
                 cambió a la función SQL aplicar_cambios (una transacción atómica).

   Así engine.ts sigue siendo la única fuente de la lógica de negocio.
   Convenciones:
   · Tx.id en memoria = «numero» del negocio (#1, #2…), no el id interno de la base.
   · turnos / movs / fabs / envios usan ids locales 1..n (como el engine) y `ids` guarda el id real.
   · Una fila nueva viaja con id NEGATIVO temporal; la base lo reemplaza por el real.
   ═════════════════════════════════════════════════════════════════════════ */

type Row = Record<string, any>;
export type Ids = { turnos: number[]; movs: number[]; fabs: number[]; envios: number[] };
export type Cargado = { s: S; ids: Ids };

const N = (x: unknown) => (x == null ? 0 : Number(x));
const iso = (x: unknown) => new Date(x as string).toISOString();
const opt = <T,>(v: unknown, f: (x: any) => T): T | undefined => (v == null ? undefined : f(v));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// PostgREST devuelve como máximo 1000 filas por consulta: se pagina
async function todas(sb: SupabaseClient, tabla: string, nid: string, orden = 'id'): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from(tabla).select('*').eq('negocio_id', nid).order(orden).range(i, i + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const uno = async (sb: SupabaseClient, tabla: string, col: string, nid: string): Promise<Row> => {
  const { data, error } = await sb.from(tabla).select('*').eq(col, nid).single();
  if (error) throw new Error(`${tabla}: ${error.message}`);
  return data;
};
const agrupar = (rows: Row[], k: string) => {
  const m = new Map<number, Row[]>();
  for (const r of rows) { const a = m.get(r[k]); if (a) a.push(r); else m.set(r[k], [r]); }
  return m;
};

/* ───────── Base de datos → S ───────── */
export async function cargar(sb: SupabaseClient, nid: string): Promise<Cargado> {
  const [neg, cfg, medios, pas, cuo, plat, hh, hhp, prods, comb, ins, rec, recIns, fabs, cont, turn, movs, txs, items, pagos, env] = await Promise.all([
    uno(sb, 'negocios', 'id', nid), uno(sb, 'negocio_config', 'negocio_id', nid),
    todas(sb, 'medios_pago', nid, 'orden'), todas(sb, 'pasarelas', nid, 'orden'), todas(sb, 'pasarela_cuotas', nid, 'pasarela_id'),
    todas(sb, 'plataformas', nid, 'orden'), todas(sb, 'happy_hour', nid), todas(sb, 'happy_hour_productos', nid, 'happy_id'),
    todas(sb, 'productos', nid), todas(sb, 'combo_items', nid, 'combo_id'), todas(sb, 'insumos', nid),
    todas(sb, 'recetas', nid), todas(sb, 'receta_insumos', nid, 'receta_id'), todas(sb, 'fabricaciones', nid),
    todas(sb, 'contactos', nid), todas(sb, 'turnos', nid), todas(sb, 'movimientos_caja', nid),
    todas(sb, 'transacciones', nid), todas(sb, 'transaccion_items', nid), todas(sb, 'transaccion_pagos', nid), todas(sb, 'envios_marketing', nid),
  ]);

  const cfgS: Cfg = {
    ...cfgDefault(),
    packaging: N(cfg.packaging), envio: N(cfg.envio), comision: N(cfg.comision), iibb: N(cfg.iibb), retenciones: N(cfg.retenciones),
    redTipo: cfg.red_tipo, redMult: N(cfg.red_mult), mv: N(cfg.margen_venta), mm: N(cfg.margen_mayorista), desc: N(cfg.descuento),
    mgOk: N(cfg.mg_ok), mgBajo: N(cfg.mg_bajo),
    trasladaCom: !!cfg.traslada_com, trasladaCuotas: !!cfg.traslada_cuotas, demoraFondos: !!cfg.demora_fondos, bloqueaMin: !!cfg.bloquea_min,
    pasarelas: pas.map(p => ({ name: p.nombre, pct: N(p.pct) })),
    plataformas: plat.map(p => ({ name: p.nombre, pct: N(p.pct), dias: N(p.dias_liberacion) })),
    cuotas: Object.fromEntries(CUOTAS.map(n => [n, pas.map(p => N(cuo.find(c => c.pasarela_id === p.id && c.cuotas === n)?.pct))])) as Record<number, number[]>,
    fid: { activo: !!cfg.fid_activo, pesos: N(cfg.fid_pesos), valor: N(cfg.fid_valor) },
    happy: hh.map(h => ({ id: h.id, name: h.nombre, activo: !!h.activo, dias: (h.dias ?? []).map(Number), desde: String(h.desde).slice(0, 5), hasta: String(h.hasta).slice(0, 5),
      pct: N(h.pct), pids: hhp.filter(x => x.happy_id === h.id).map(x => x.producto_id) })),
    camp: { diasCumple: N(cfg.camp_dias_cumple), diasRecompra: N(cfg.camp_dias_recompra), minCompras: N(cfg.camp_min_compras),
      diasInactivo: N(cfg.camp_dias_inactivo), ofertaPct: N(cfg.camp_oferta_pct) },
  };

  const comboBy = agrupar(comb, 'combo_id');
  const prodsS: Prod[] = prods.map(p => {
    const cs = comboBy.get(p.id);
    const x: Prod = { id: p.id, name: p.nombre, stock: N(p.stock), min: N(p.stock_min), cost: N(p.costo), price: N(p.precio) };
    if (p.es_combo || cs) x.combo = (cs ?? []).map(c => ({ pid: c.producto_id, qty: N(c.cantidad) }));
    if (p.notas) x.notes = p.notas; if (p.descripcion) x.desc = p.descripcion; if (p.seo) x.seo = p.seo;
    return x;
  });
  const insS: Insumo[] = ins.map(i => ({ id: i.id, name: i.nombre, unit: i.unidad, stock: N(i.stock), min: N(i.stock_min), cost: N(i.costo) }));
  const recInsBy = agrupar(recIns, 'receta_id');
  const recS: Receta[] = rec.map(r => ({ id: r.id, name: r.nombre, lote: N(r.lote), unidad: r.unidad, mo: N(r.mano_obra), cf: N(r.costos_fijos), merma: N(r.merma), pid: r.producto_id,
    ins: (recInsBy.get(r.id) ?? []).map(l => ({ iid: l.insumo_id, qty: N(l.cantidad), merma: opt(l.merma, Number) })) }));
  const contS: Contacto[] = cont.map(c => ({ id: c.id, tipo: c.tipo, name: c.nombre, doc: c.doc, tel: c.telefono, email: c.email, dir: c.direccion, cumple: c.cumple ?? undefined }));

  // turnos / movs / fabs / envios: ids locales 1..n (índice + 1), igual que el engine
  const ids: Ids = { turnos: turn.map(t => t.id), movs: movs.map(m => m.id), fabs: fabs.map(f => f.id), envios: env.map(e => e.id) };
  const turLocal = new Map<number, number>(turn.map((t, i) => [t.id, i + 1]));
  const turnosS: Turno[] = turn.map((t, i) => ({ id: i + 1, abre: iso(t.abre), cierra: t.cierra ? iso(t.cierra) : undefined, inicial: t.inicial ?? {}, nota: t.nota ?? '',
    esperado: t.esperado ?? undefined, contado: t.contado ?? undefined, cierreNota: t.cierre_nota ?? undefined }));
  const movsS: Mov[] = movs.map((m, i) => ({ id: i + 1, turno: turLocal.get(m.turno_id) ?? 0, at: iso(m.fecha), tipo: m.tipo, medio: m.medio, monto: N(m.monto), desc: m.descripcion, void: !!m.anulado }));
  const fabsS: Fab[] = fabs.map((f, i) => ({ id: i + 1, rid: f.receta_id ?? 0, qty: N(f.cantidad), at: iso(f.fecha), costoU: N(f.costo_unitario), desc: !!f.descontado }));
  const envS: Envio[] = env.map((e, i) => ({ id: i + 1, cid: e.contacto_id, tipo: e.tipo, ref: e.ref, at: iso(e.fecha) }));

  // transacciones: Tx.id = numero; pays / paidBy se traducen de id interno a numero
  const numDe = new Map<number, number>(txs.map(t => [t.id, t.numero]));
  const itemsBy = agrupar(items, 'transaccion_id'), pagosBy = agrupar(pagos, 'transaccion_id');
  const txsS: Tx[] = txs.map(t => {
    const x: Tx = { id: t.numero, type: t.tipo as Tipo, desc: t.descripcion, amount: N(t.monto), costAmt: N(t.costo_total), medio: t.medio, status: t.estado,
      at: iso(t.fecha), void: !!t.anulada, disc: N(t.descuento),
      items: (itemsBy.get(t.id) ?? []).map(i => ({ pid: i.insumo_id ?? i.producto_id ?? 0, name: i.nombre, qty: N(i.cantidad), price: N(i.precio), cost: N(i.costo),
        ins: i.insumo_id ? true : undefined, hh: opt(i.hh_pct, Number) })) };
    x.due = t.vence ?? undefined; x.paidBy = opt(t.pagado_por_id, (v: number) => numDe.get(v)); x.pays = opt(t.paga_a_id, (v: number) => numDe.get(v));
    x.iva = opt(t.iva, Number); x.prov = t.proveedor ?? undefined; x.rec = opt(t.recargo, Number);
    const sp = pagosBy.get(t.id); if (sp?.length) x.split = sp.map(p => ({ medio: p.medio, monto: N(p.monto) }));
    x.comAbs = opt(t.com_absorbida, Number); x.comTras = opt(t.com_trasladada, Number); x.pas = t.pasarela ?? undefined; x.cuotas = opt(t.cuotas, Number);
    x.plat = t.plataforma ?? undefined; x.libera = t.libera_en ? iso(t.libera_en) : undefined; x.cid = t.contacto_id ?? undefined;
    x.hh = opt(t.hh_descuento, Number); x.ptsGan = opt(t.pts_ganados, Number); x.ptsUsa = opt(t.pts_usados, Number); x.ptsDesc = opt(t.pts_descuento, Number);
    return x;
  });

  const mediosS: Medio[] = medios.map(m => ({ name: m.nombre, tipo: m.tipo, com: N(m.comision) }));
  const s: S = { prods: prodsS, txs: txsS, medios: mediosS, caja0: N(cfg.caja_inicial), banco0: N(cfg.banco_inicial), seq: txsS.reduce((a, t) => Math.max(a, t.id), 0), cfg: cfgS,
    neg: { nombre: neg.nombre, cuit: neg.cuit, tel: neg.telefono, dir: neg.direccion, email: neg.email },
    turnos: turnosS, movs: movsS, insumos: insS, recetas: recS, fabs: fabsS, contactos: contS, envios: envS };
  return { s, ids };
}

/* ───────── S antes / después → paquete de cambios ───────── */
export function diff(a: S, b: S, ids: Ids): Record<string, any> {
  const c: Record<string, any> = {};
  const oldP = new Map(a.prods.map(p => [p.id, p])), nP = new Set(b.prods.filter(p => !oldP.has(p.id)).map(p => p.id));
  const oldI = new Map(a.insumos.map(p => [p.id, p])), nI = new Set(b.insumos.filter(p => !oldI.has(p.id)).map(p => p.id));
  const oldC = new Set(a.contactos.map(p => p.id)), nC = new Set(b.contactos.filter(p => !oldC.has(p.id)).map(p => p.id));
  const oldR = new Set(a.recetas.map(p => p.id)), nR = new Set(b.recetas.filter(p => !oldR.has(p.id)).map(p => p.id));
  const oldT = new Map(a.txs.map(t => [t.id, t])), nT = new Set(b.txs.filter(t => !oldT.has(t.id)).map(t => t.id));
  const rp = (id: number) => (nP.has(id) ? -id : id), ri = (id: number) => (nI.has(id) ? -id : id);
  const rc = (id: number) => (nC.has(id) ? -id : id), rr = (id: number) => (nR.has(id) ? -id : id), rt = (n: number) => (nT.has(n) ? -n : n);
  const rtu = (local: number) => (local > a.turnos.length ? -local : ids.turnos[local - 1]);
  const comboOut = (p: Prod) => (p.combo ?? []).map(x => ({ producto_id: rp(x.pid), cantidad: x.qty }));

  // configuración (reemplazo completo; solo la guarda un dueño / admin)
  const cfgKey = (s: S) => ({ neg: s.neg, caja0: s.caja0, banco0: s.banco0, cfg: s.cfg, medios: s.medios });
  if (!igual(cfgKey(a), cfgKey(b))) {
    const k = b.cfg;
    c.config = {
      neg: { nombre: b.neg.nombre, cuit: b.neg.cuit, telefono: b.neg.tel, direccion: b.neg.dir, email: b.neg.email },
      cfg: { caja_inicial: b.caja0, banco_inicial: b.banco0, packaging: k.packaging, envio: k.envio, comision: k.comision, iibb: k.iibb, retenciones: k.retenciones,
        red_tipo: k.redTipo, red_mult: k.redMult, margen_venta: k.mv, margen_mayorista: k.mm, descuento: k.desc, mg_ok: k.mgOk, mg_bajo: k.mgBajo,
        traslada_com: k.trasladaCom, traslada_cuotas: k.trasladaCuotas, demora_fondos: k.demoraFondos, bloquea_min: k.bloqueaMin,
        fid_activo: k.fid.activo, fid_pesos: k.fid.pesos, fid_valor: k.fid.valor,
        camp_dias_cumple: k.camp.diasCumple, camp_dias_recompra: k.camp.diasRecompra, camp_min_compras: k.camp.minCompras,
        camp_dias_inactivo: k.camp.diasInactivo, camp_oferta_pct: k.camp.ofertaPct },
      medios: b.medios.map(m => ({ nombre: m.name, tipo: m.tipo, comision: m.com ?? 0 })),
      pasarelas: k.pasarelas.map((p, i) => ({ nombre: p.name, pct: p.pct, cuotas: Object.fromEntries(CUOTAS.map(n => [n, k.cuotas[n]?.[i] ?? 0])) })),
      plataformas: k.plataformas.map(p => ({ nombre: p.name, pct: p.pct, dias_liberacion: p.dias ?? 0 })),
      happy: k.happy.map(h => ({ nombre: h.name, activo: h.activo, dias: h.dias, desde: h.desde, hasta: h.hasta, pct: h.pct, pids: h.pids })),
    };
  }

  // contactos
  const cNew = b.contactos.filter(x => nC.has(x.id)).map(x => ({ lid: -x.id, tipo: x.tipo, nombre: x.name, doc: x.doc, telefono: x.tel, email: x.email, direccion: x.dir, cumple: x.cumple ?? null }));
  const cDel = a.contactos.filter(x => !b.contactos.some(y => y.id === x.id)).map(x => x.id);
  if (cNew.length || cDel.length) c.contactos = { nuevos: cNew, borrados: cDel };

  // productos (el stock viaja como DELTA)
  const pNew = b.prods.filter(p => nP.has(p.id)).map(p => ({ lid: -p.id, nombre: p.name, stock: p.stock, stock_min: p.min, costo: p.cost, precio: p.price, es_combo: !!p.combo,
    notas: p.notes ?? null, descripcion: p.desc ?? null, seo: p.seo ?? null, combo: comboOut(p) }));
  const pCh: Row[] = [];
  for (const p of b.prods) {
    const o = oldP.get(p.id); if (!o) continue;
    const ch: Row = {}, d = r3(p.stock - o.stock);
    if (d !== 0) ch.stock_delta = d;
    if (p.name !== o.name) ch.nombre = p.name;
    if (p.min !== o.min) ch.stock_min = p.min;
    if (p.cost !== o.cost) ch.costo = p.cost;
    if (p.price !== o.price) ch.precio = p.price;
    if ((p.notes ?? null) !== (o.notes ?? null)) ch.notas = p.notes ?? null;
    if ((p.desc ?? null) !== (o.desc ?? null)) ch.descripcion = p.desc ?? null;
    if (!igual(p.seo ?? null, o.seo ?? null)) ch.seo = p.seo ?? null;
    if (!igual(p.combo ?? null, o.combo ?? null)) ch.combo = comboOut(p);
    if (Object.keys(ch).length) pCh.push({ id: p.id, ...ch });
  }
  const pDel = a.prods.filter(p => !b.prods.some(x => x.id === p.id)).map(p => p.id);
  if (pNew.length || pCh.length || pDel.length) c.productos = { nuevos: pNew, cambios: pCh, borrados: pDel };

  // insumos
  const iNew = b.insumos.filter(p => nI.has(p.id)).map(p => ({ lid: -p.id, nombre: p.name, unidad: p.unit, stock: p.stock, stock_min: p.min, costo: p.cost }));
  const iCh: Row[] = [];
  for (const p of b.insumos) {
    const o = oldI.get(p.id); if (!o) continue;
    const ch: Row = {}, d = r3(p.stock - o.stock);
    if (d !== 0) ch.stock_delta = d;
    if (p.name !== o.name) ch.nombre = p.name;
    if (p.unit !== o.unit) ch.unidad = p.unit;
    if (p.min !== o.min) ch.stock_min = p.min;
    if (p.cost !== o.cost) ch.costo = p.cost;
    if (Object.keys(ch).length) iCh.push({ id: p.id, ...ch });
  }
  if (iNew.length || iCh.length) c.insumos = { nuevos: iNew, cambios: iCh };

  // recetas y fabricaciones
  const rNew = b.recetas.filter(r => nR.has(r.id)).map(r => ({ lid: -r.id, nombre: r.name, lote: r.lote, unidad: r.unidad, mano_obra: r.mo, costos_fijos: r.cf, merma: r.merma,
    producto_id: rp(r.pid), ins: r.ins.map(l => ({ insumo_id: ri(l.iid), cantidad: l.qty, merma: l.merma ?? null })) }));
  const rDel = a.recetas.filter(r => !b.recetas.some(x => x.id === r.id)).map(r => r.id);
  if (rNew.length || rDel.length) c.recetas = { nuevos: rNew, borrados: rDel };
  const fNew = b.fabs.slice(a.fabs.length).map(f => ({ receta_id: rr(f.rid), cantidad: f.qty, fecha: f.at, costo_unitario: f.costoU, descontado: f.desc }));
  if (fNew.length) c.fabricaciones = fNew;

  // caja
  const tNew = b.turnos.slice(a.turnos.length).map(t => ({ lid: -t.id, abre: t.abre, inicial: t.inicial, nota: t.nota }));
  const tCh: Row[] = [];
  a.turnos.forEach((o, i) => {
    const t = b.turnos[i]; if (!t) return;
    const ch: Row = {};
    if (!igual(t.inicial, o.inicial)) ch.inicial = t.inicial;
    if ((t.cierra ?? null) !== (o.cierra ?? null)) ch.cierra = t.cierra ?? null;
    if (!igual(t.esperado ?? null, o.esperado ?? null)) ch.esperado = t.esperado ?? null;
    if (!igual(t.contado ?? null, o.contado ?? null)) ch.contado = t.contado ?? null;
    if ((t.cierreNota ?? null) !== (o.cierreNota ?? null)) ch.cierre_nota = t.cierreNota ?? null;
    if (Object.keys(ch).length) tCh.push({ id: ids.turnos[i], ...ch });
  });
  if (tNew.length || tCh.length) c.turnos = { nuevos: tNew, cambios: tCh };
  const mNew = b.movs.slice(a.movs.length).map(m => ({ turno_id: rtu(m.turno), fecha: m.at, tipo: m.tipo, medio: m.medio, monto: m.monto, descripcion: m.desc }));
  const mCh: Row[] = [];
  a.movs.forEach((o, i) => { const m = b.movs[i]; if (m && m.void !== o.void) mCh.push({ id: ids.movs[i], anulado: m.void }); });
  if (mNew.length || mCh.length) c.movimientos = { nuevos: mNew, cambios: mCh };

  // transacciones
  const xNew = b.txs.filter(t => nT.has(t.id)).map(t => ({
    lid: -t.id, tipo: t.type, descripcion: t.desc, monto: t.amount, costo_total: t.costAmt, medio: t.medio, estado: t.status, vence: t.due ?? null, fecha: t.at,
    descuento: t.disc, iva: t.iva ?? null, proveedor: t.prov ?? null, recargo: t.rec ?? null, com_absorbida: t.comAbs ?? null, com_trasladada: t.comTras ?? null,
    pasarela: t.pas ?? null, cuotas: t.cuotas ?? null, plataforma: t.plat ?? null, libera_en: t.libera ?? null, contacto_id: t.cid ? rc(t.cid) : null,
    hh_descuento: t.hh ?? null, pts_ganados: t.ptsGan ?? null, pts_usados: t.ptsUsa ?? null, pts_descuento: t.ptsDesc ?? null,
    paga_a_id: t.pays != null ? rt(t.pays) : null,
    items: t.items.map(i => ({ producto_id: i.ins || !i.pid ? null : rp(i.pid), insumo_id: i.ins ? ri(i.pid) : null, nombre: i.name, cantidad: i.qty, precio: i.price, costo: i.cost, hh_pct: i.hh ?? null })),
    split: (t.split ?? []).map(p => ({ medio: p.medio, monto: p.monto })) }));
  const xCh: Row[] = [];
  for (const t of b.txs) {
    const o = oldT.get(t.id); if (!o) continue;
    const ch: Row = {};
    if (t.status !== o.status) ch.estado = t.status;
    if (t.void !== o.void) ch.anulada = t.void;
    if ((t.paidBy ?? null) !== (o.paidBy ?? null)) ch.pagado_por_id = t.paidBy == null ? null : rt(t.paidBy);
    if ((t.libera ?? null) !== (o.libera ?? null)) ch.libera_en = t.libera ?? null;
    if (Object.keys(ch).length) xCh.push({ numero: t.id, ...ch });
  }
  if (xNew.length || xCh.length) c.transacciones = { nuevos: xNew, cambios: xCh };

  const eNew = b.envios.slice(a.envios.length).map(e => ({ contacto_id: rc(e.cid), tipo: e.tipo, ref: e.ref, fecha: e.at }));
  if (eNew.length) c.envios = eNew;
  return c;
}

const ERRORES: Record<string, string> = {
  '23503': 'No se puede eliminar o modificar: tiene operaciones, recetas o combos asociados.',
  '23505': 'Ya existe un registro con ese nombre, o ya hay una caja abierta.',
  '23514': 'Hay un valor fuera de rango (por ejemplo, stock o monto negativo).',
};

/** Guarda en Supabase lo que cambió entre `base` (último estado leído) y `next`. Devuelve un mensaje de error o null. */
export async function guardar(sb: SupabaseClient, nid: string, base: Cargado, next: S): Promise<string | null> {
  const c = diff(base.s, next, base.ids);
  if (!Object.keys(c).length) return null;
  const { error } = await sb.rpc('aplicar_cambios', { p_negocio: nid, c });
  if (!error) return null;
  if (/row-level security/i.test(error.message)) return 'No tenés permiso para esta operación (o tu suscripción está vencida).';
  return error.code && ERRORES[error.code] ? ERRORES[error.code] : error.message;
}
