import type { Seo } from './ia';
export type Tipo = 'SALE' | 'PURCHASE' | 'EXPENSE' | 'COLLECTION' | 'PAYMENT';
export type St = 'PAID' | 'PENDING';
export type Prod = { id: number; name: string; stock: number; min: number; cost: number; price: number;
  combo?: { pid: number; qty: number }[]; notes?: string; desc?: string; seo?: Seo };
export type Medio = { name: string; tipo: 'caja' | 'banco' | 'credito'; com?: number }; // com = comisión % del medio
export type Item = { pid: number; name: string; qty: number; price: number; cost: number; ins?: boolean; hh?: number }; // hh = % de Happy Hour aplicado a la línea
export type Pago = { medio: string; monto: number };
export type Tx = { id: number; type: Tipo; desc: string; amount: number; costAmt: number; medio: string; status: St;
  due?: string; at: string; items: Item[]; void: boolean; paidBy?: number; pays?: number; disc: number; iva?: number; prov?: string;
  rec?: number; split?: Pago[]; // rec = recargo trasladado al cliente · split = pago mixto
  comAbs?: number; comTras?: number; pas?: string; cuotas?: number; plat?: string; libera?: string; // libera = fecha en que la plataforma libera los fondos (si es futura: «fondos en tránsito»)
  cid?: number; hh?: number; ptsGan?: number; ptsUsa?: number; ptsDesc?: number }; // cid = contacto (cliente / proveedor) vinculado · hh = $ Happy Hour · pts* = puntos ganados / usados / $ descontados por puntos
 // comAbs = comisión que absorbe el comercio (gasto) · comTras = comisión trasladada que la pasarela/plataforma retiene al cobrar · plat = canal de venta (plataforma)
export type Turno = { id: number; abre: string; cierra?: string; inicial: Record<string, number>; nota: string;
  esperado?: Record<string, number>; contado?: Record<string, number>; cierreNota?: string };
export type Mov = { id: number; turno: number; at: string; tipo: 'IN' | 'OUT'; medio: string; monto: number; desc: string; void: boolean };
export type Insumo = { id: number; name: string; unit: string; stock: number; min: number; cost: number };
export type RLn = { iid: number; qty: number; merma?: number }; // merma % propia del insumo (si falta, usa la general)
export type Receta = { id: number; name: string; lote: number; unidad: string; ins: RLn[]; mo: number; cf: number; merma: number; pid: number };
export type Fab = { id: number; rid: number; qty: number; at: string; costoU: number; desc: boolean };
export type S = { prods: Prod[]; txs: Tx[]; medios: Medio[]; caja0: number; banco0: number; seq: number; cfg: Cfg; neg: Neg;
  turnos: Turno[]; movs: Mov[]; insumos: Insumo[]; recetas: Receta[]; fabs: Fab[]; contactos: Contacto[]; envios: Envio[] };

export const money = (v: number) => (v < 0 ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('es-AR');
const now = () => new Date().toISOString();
const r2 = (x: number) => Math.round(x * 100) / 100;
export const medioTipo = (s: S, n: string) => s.medios.find(m => m.name === n)?.tipo ?? 'banco';
const prod = (s: S, id: number) => s.prods.find(p => p.id === id);

// % seguro para fórmulas: vacío, NaN, negativo, 0 o ≥ 100 → 0 (sin cargo); tope 95 para no dividir por casi cero
export const pctSeguro = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 100 ? Math.min(x, 95) : 0);
// Gross-up: monto / (1 − %). Con % inválido o 0 devuelve el monto sin tocar (nunca divide por cero ni da NaN/Infinity)
export const grossUp = (monto: number, pct: number | undefined | null) => {
  const m = Number.isFinite(monto) ? monto : 0, p = pctSeguro(pct);
  return p > 0 ? r2(m / (1 - p / 100)) : r2(m);
};

const CERRADA = 'La caja está cerrada. Abrila en la pestaña Apertura.';
export const turnoActual = (s: S) => s.turnos[s.turnos.length - 1];
export const abierta = (s: S) => { const t = turnoActual(s); return !!t && !t.cierra; };

// stock de un combo = cuántos combos se pueden armar con los componentes
export const stk = (s: S, p: Prod): number => p.combo
  ? Math.min(...p.combo.map(c => { const q = prod(s, c.pid); return q ? Math.floor(stk(s, q) / c.qty) : 0; }))
  : p.stock;
function mueve(s: S, p: Prod, d: number) {
  if (p.combo) p.combo.forEach(c => { const q = prod(s, c.pid); if (q) mueve(s, q, d * c.qty); });
  else p.stock = Math.max(0, p.stock + d);
}
function recosto(s: S) {
  s.prods.forEach(p => { if (p.combo) p.cost = Math.round(p.combo.reduce((a, c) => a + c.qty * (prod(s, c.pid)?.cost ?? 0), 0) * 100) / 100; });
}
export function esperado(s: S, t: Turno) {
  const r: Record<string, number> = {};
  for (const m of s.medios) if (m.tipo !== 'credito') r[m.name] = t.inicial[m.name] ?? 0;
  const a = +new Date(t.abre), z = t.cierra ? +new Date(t.cierra) : Infinity;
  for (const f of flows(s)) if (+f.d >= a && +f.d <= z && f.m in r) r[f.m] += f.c === 'cobros' ? f.a : -f.a;
  for (const m of s.movs) if (m.turno === t.id && !m.void && m.medio in r) r[m.medio] += m.tipo === 'IN' ? m.monto : -m.monto;
  return r;
}

function push(s: S, t: Omit<Tx, 'id' | 'void'>, due?: string) {
  if (medioTipo(s, t.medio) === 'credito' && t.type !== 'COLLECTION' && t.type !== 'PAYMENT') t.status = 'PENDING';
  const x: Tx = { ...t, id: ++s.seq, void: false, due: t.status === 'PENDING' ? due : undefined };
  s.txs.push(x); return x;
}

/* ───────── Cuentas corrientes: abonos parciales ───────── */
export const abonos = (s: S, id: number) => s.txs.filter(t => !t.void && t.pays === id);
export const saldo = (s: S, t: Tx) => Math.max(0, r2(t.amount - abonos(s, t.id).reduce((a, x) => a + x.amount, 0)));

// recargo que se traslada al cliente según la comisión del medio de pago (solo si la config lo pide)
export function recargoMedio(s: S, medio: string, monto: number) {
  const c = s.cfg.trasladaCom ? pctSeguro(s.medios.find(m => m.name === medio)?.com) : 0;
  return c > 0 ? r2(grossUp(monto, c) - monto) : 0;
}

// Recargo de una pasarela + cuotas. Respeta los switches de Configuración:
// lo trasladado se suma al ticket (rec); lo que NO se traslada lo absorbe el comercio (abs).
export function recargoPasarela(s: S, pas: number, cuotas: number, monto: number) {
  const pa = s.cfg.pasarelas[pas - 1];
  if (!pa) return { rec: 0, abs: 0, cliente: monto, pctCom: 0, pctCuo: 0, pctT: 0 };
  const pCom = pctSeguro(pa.pct), pCuo = cuotas > 1 ? pctSeguro(s.cfg.cuotas[cuotas]?.[pas - 1]) : 0;
  const tCom = s.cfg.trasladaCom ? pCom : 0, tCuo = s.cfg.trasladaCuotas ? pCuo : 0;
  const pctT = pctSeguro(tCom + tCuo);
  const cliente = grossUp(monto, pctT);
  const abs = r2((s.cfg.trasladaCom ? 0 : monto * pCom / 100) + (s.cfg.trasladaCuotas ? 0 : monto * pCuo / 100));
  return { rec: r2(cliente - monto), abs, cliente, pctCom: pCom, pctCuo: pCuo, pctT };
}

// Comisión de una plataforma / e-commerce (canal de venta: MercadoLibre, Tienda Nube, Shopify…)
// · Trasladar ON : se suma al ticket (gross-up) y la plataforma la retiene → el comercio recibe el total sin recargo.
// · Trasladar OFF: el ticket queda en bruto; la plataforma retiene la comisión → se acredita el neto y la diferencia es gasto.
export function recargoPlataforma(s: S, plat: number, monto: number) {
  const pl = s.cfg.plataformas[plat - 1];
  const pct = pctSeguro(pl?.pct); // vacío / 0 / inválido → 0: sin recargo ni comisión, sin divisiones por cero
  if (!pl || pct === 0) return { rec: 0, abs: 0, cliente: monto, pct: 0 };
  if (s.cfg.trasladaCom) {
    const cliente = grossUp(monto, pct);
    return { rec: r2(cliente - monto), abs: 0, cliente, pct };
  }
  return { rec: 0, abs: r2(monto * pct / 100), cliente: monto, pct };
}

// Las pasarelas no son cuentas propias: su plata cae en la primera cuenta tipo banco
export const cuentaDe = (s: S, n: string) =>
  s.medios.some(m => m.name === n) ? n : (s.medios.find(m => m.tipo === 'banco')?.name ?? n);

export type Ln = { pid: number; qty: number; cost: number; ins?: boolean };
export type GLn = { cat: string; desc: string; monto: number };
export function calcIva(base: number, pct: number, inc: boolean) {
  const r = (x: number) => Math.round(x * 100) / 100;
  if (pct <= 0) return { total: r(base), iva: 0 };
  if (inc) return { total: r(base), iva: r(base - base / (1 + pct / 100)) };
  const iva = r(base * pct / 100); return { total: r(base + iva), iva };
}
const sfx = (pct: number, iva: number, inc: boolean, prov: string) =>
  (iva ? ` · IVA ${pct}% ${money(iva)}${inc ? ' incl.' : ''}` : '') + (prov ? ` · Prov. ${prov}` : '');

export function venta(s: S, cart: Record<number, number>, medio: string, st: St, due: string | undefined,
  nota = '', pct = 0, at = now(), ivaPct = 0, ivaInc = false, split?: Pago[], pas = 0, cuotas = 1, plat = 0, cid = 0, canje = 0): string | null {
  if (!abierta(s)) return CERRADA;
  const ids = Object.keys(cart).map(Number);
  if (!ids.length) return 'El ticket está vacío.';
  for (const id of ids) {
    const p = prod(s, id);
    if (!p) return 'Un producto del ticket ya no existe.';
    if (stk(s, p) < cart[id]) return `Stock insuficiente de ${p.name} (hay ${stk(s, p)}).`;
    if (s.cfg.bloqueaMin && stk(s, p) < p.min) return `${p.name} está bajo el stock mínimo y la configuración bloquea su venta.`;
  }
  const dd = descuentos(s, cart, pct, canje, cid, new Date(at)); // Happy Hour → % manual → canje de puntos
  if (dd.err) return dd.err;
  const items: Item[] = []; let bruto = 0, costo = 0;
  for (const id of ids) {
    const p = prod(s, id)!, q = cart[id], hp = hhPct(s, id, new Date(at));
    items.push({ pid: id, name: p.name, qty: q, price: p.price, cost: p.cost, hh: hp || undefined });
    bruto += q * p.price; costo += q * p.cost;
  }
  const disc = r2(dd.hh + dd.man + dd.pts);
  const { total, iva } = calcIva(bruto - disc, ivaPct, ivaInc);

  // pago mixto: los montos (sin recargo) deben sumar el total de la venta
  let parts: Pago[] | undefined;
  if (split && split.length) {
    if (split.some(p => !(p.monto > 0) || medioTipo(s, p.medio) === 'credito')) return 'El pago mixto necesita montos mayores a 0 en medios que no sean fiado.';
    const sum = split.reduce((a, p) => a + p.monto, 0);
    if (Math.abs(sum - total) > 0.01) return `Los pagos mixtos suman ${money(sum)} y la venta es de ${money(total)}.`;
    parts = split.map(p => ({ medio: p.medio, monto: r2(p.monto + recargoMedio(s, p.medio, p.monto)) }));
    st = 'PAID'; medio = parts.map(p => p.medio).join(' + ');
  }

  // canal de venta: plataforma (e-commerce) o pasarela de pago (solo si no es pago mixto)
  let rec = 0, comAbs = 0, comTras = 0, pasName: string | undefined, platName: string | undefined, pasTxt = '', libera: string | undefined;
  if (parts) rec = r2(parts.reduce((a, p) => a + p.monto, 0) - total);
  else if (plat > 0) {
    const pl = s.cfg.plataformas[plat - 1];
    if (!pl) return 'La plataforma elegida ya no existe en Configuración.';
    const r = recargoPlataforma(s, plat, total);
    rec = r.rec; comAbs = r.abs; comTras = r.rec; platName = pl.name; medio = pl.name; st = 'PAID'; due = undefined;
    pasTxt = ` · Canal ${pl.name}`;
    const dd2 = Number(pl.dias); // demora de liberación de fondos: queda «en tránsito» hasta cumplirse el plazo
    if (s.cfg.demoraFondos && Number.isFinite(dd2) && dd2 > 0) {
      libera = new Date(+new Date(at) + dd2 * 864e5).toISOString();
      pasTxt += ` · Fondos en tránsito ${dd2} día${dd2 === 1 ? '' : 's'}`;
    }
  } else if (pas > 0) {
    const pa = s.cfg.pasarelas[pas - 1];
    if (!pa) return 'La pasarela elegida ya no existe en Configuración.';
    if (cuotas > 1 && s.cfg.cuotas[cuotas] == null) return 'Esa cantidad de cuotas no está configurada.';
    const r = recargoPasarela(s, pas, cuotas, total);
    rec = r.rec; comAbs = r.abs; comTras = r.rec; pasName = pa.name; medio = pa.name; st = 'PAID'; due = undefined;
    pasTxt = ` · Pasarela ${pa.name}${cuotas > 1 ? ` ${cuotas} cuotas` : ''}`;
  } else rec = recargoMedio(s, medio, total);

  ids.forEach(id => mueve(s, prod(s, id)!, -cart[id]));
  push(s, { type: 'SALE', desc: items.map(i => `${i.qty}× ${i.name}`).join(', ') + (dd.man ? ` (desc. ${pct}%)` : '') + (dd.hh ? ` · Happy Hour −${money(dd.hh)}` : '') + (dd.pts ? ` · Canje ${canje} pts −${money(dd.pts)}` : '') + sfx(ivaPct, iva, ivaInc, '')
      + (parts ? ` · Mixto: ${parts.map(p => `${p.medio} ${money(p.monto)}`).join(' + ')}` : '') + pasTxt
      + (rec ? ` · Recargo ${platName ? 'plataforma' : pasName ? 'pasarela' : 'medio'} ${money(rec)}` : '') + (comAbs ? ` · ${platName ? 'Comisión por Plataforma' : 'Comisión absorbida'} ${money(comAbs)}` : '') + (nota ? ` — ${nota}` : ''),
    amount: r2(total + rec), costAmt: costo, medio, status: st, at, items, disc, iva,
    cid: cid || undefined, hh: dd.hh || undefined, ptsGan: puntosGanados(s, total) || undefined, ptsUsa: canje > 0 ? canje : undefined, ptsDesc: dd.pts || undefined,
    rec: rec || undefined, split: parts,
    comAbs: comAbs || undefined, comTras: comTras || undefined, pas: pasName, plat: platName, libera, cuotas: pasName && cuotas > 1 ? cuotas : undefined }, due);
  return null;
}

export function compra(s: S, lines: Ln[], medio: string, st: St, due: string | undefined, prov = '',
  ivaPct = 0, ivaInc = false, at = now()): string | null {
  if (!abierta(s)) return CERRADA;
  if (!lines.length) return 'El detalle de la compra está vacío.';
  const ref = (l: Ln) => l.ins ? s.insumos.find(i => i.id === l.pid) : prod(s, l.pid);
  for (const l of lines) {
    const pp = ref(l);
    if (!pp) return 'Producto o insumo inexistente.';
    if (!l.ins && (pp as Prod).combo) return 'Un combo no se compra: comprá sus productos.';
    if (l.qty <= 0 || l.cost < 0) return 'Cantidad y costo deben ser válidos.';
  }
  const f = ivaInc && ivaPct ? 1 / (1 + ivaPct / 100) : 1; // el costo se guarda sin IVA
  const items: Item[] = []; let sum = 0;
  for (const l of lines) {
    const p = ref(l)!, cn = l.cost * f, tot = p.stock + l.qty;
    p.cost = Math.round(((p.stock * p.cost + l.qty * cn) / tot) * 100) / 100; // costo promedio ponderado
    p.stock = Math.round(tot * 1000) / 1000; sum += l.qty * l.cost;
    items.push({ pid: p.id, name: p.name, qty: l.qty, price: 0, cost: Math.round(cn * 100) / 100, ins: !!l.ins });
  }
  recosto(s);
  const { total, iva } = calcIva(sum, ivaPct, ivaInc);
  push(s, { type: 'PURCHASE', desc: items.map(i => `${i.qty}× ${i.name}`).join(', ') + ' (compra)' + sfx(ivaPct, iva, ivaInc, prov),
    amount: total, costAmt: 0, medio, status: st, at, items, disc: 0, iva, prov: prov || undefined }, due);
  return null;
}

export function gasto(s: S, lines: GLn[], medio: string, st: St, due: string | undefined, prov = '',
  ivaPct = 0, ivaInc = false, at = now()): string | null {
  if (!abierta(s)) return CERRADA;
  if (!lines.length || lines.some(l => !(l.monto > 0))) return 'Cargá al menos un gasto con monto mayor a 0.';
  const { total, iva } = calcIva(lines.reduce((a, l) => a + l.monto, 0), ivaPct, ivaInc);
  push(s, { type: 'EXPENSE', desc: lines.map(l => (l.desc ? `${l.cat}: ${l.desc}` : l.cat)).join(' + ') + sfx(ivaPct, iva, ivaInc, prov),
    amount: total, costAmt: 0, medio, status: st, at, items: [], disc: 0, iva, prov: prov || undefined }, due);
  return null;
}

// Cobra / paga una cuenta pendiente, total o parcialmente (monto vacío = saldo completo)
export function liquidar(s: S, id: number, medio: string, monto?: number): string | null {
  if (!abierta(s)) return CERRADA;
  const o = s.txs.find(t => t.id === id);
  if (!o || o.void || o.status !== 'PENDING') return 'Esa cuenta ya no está pendiente.';
  if (medioTipo(s, medio) === 'credito') return 'Elegí un medio real (caja o banco).';
  const sd = saldo(s, o), m = monto == null ? sd : r2(monto);
  if (!(m > 0)) return 'El monto debe ser mayor a 0.';
  if (m > sd + 0.005) return `El monto supera el saldo pendiente (${money(sd)}).`;
  const cobro = o.type === 'SALE', parcial = m < sd - 0.005;
  const n = push(s, { type: cobro ? 'COLLECTION' : 'PAYMENT', desc: `${cobro ? 'Cobro' : 'Pago'}${parcial ? ' parcial' : ''} de #${o.id} · ${o.desc}`,
    amount: m, costAmt: 0, medio, status: 'PAID', at: now(), items: [], pays: o.id, disc: 0 });
  if (!parcial) { o.status = 'PAID'; o.paidBy = n.id; }
  return null;
}

export function anular(s: S, id: number): string | null {
  const t = s.txs.find(x => x.id === id);
  if (!t || t.void) return 'La operación no existe o ya está anulada.';
  const ab = abonos(s, id);
  if (ab.length) return `Primero anulá los cobros/pagos aplicados (#${ab.map(x => x.id).join(', #')}).`;
  if (t.type === 'SALE') t.items.forEach(i => { const p = prod(s, i.pid); if (p) mueve(s, p, i.qty); });
  else if (t.type === 'PURCHASE') t.items.forEach(i => {
    const p = i.ins ? s.insumos.find(x => x.id === i.pid) : prod(s, i.pid);
    if (p) p.stock = Math.max(0, Math.round((p.stock - i.qty) * 1000) / 1000);
  });
  else if (t.type === 'COLLECTION' || t.type === 'PAYMENT') {
    const o = s.txs.find(x => x.id === t.pays);
    if (o) { o.status = 'PENDING'; o.paidBy = undefined; }
  }
  t.void = true; return null;
}

export function nuevoProd(s: S, name: string, price: number, cost: number, stock: number, min: number): string | null {
  if (!name.trim() || price <= 0) return 'Completá el nombre y un precio mayor a 0.';
  if (s.prods.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) return 'Ya existe un producto con ese nombre.';
  s.prods.push({ id: Math.max(0, ...s.prods.map(p => p.id)) + 1, name: name.trim(), price, cost, stock, min }); return null;
}

/* ───────── Caja: apertura, cierre y movimientos ───────── */
export function abrir(s: S, inicial: Record<string, number>, nota = ''): string | null {
  if (abierta(s)) return 'La caja ya está abierta.';
  s.turnos.push({ id: s.turnos.length + 1, abre: now(), inicial, nota }); return null;
}
export function actualizarInicial(s: S, inicial: Record<string, number>): string | null {
  if (!abierta(s)) return CERRADA;
  turnoActual(s).inicial = inicial; return null;
}
export function cerrar(s: S, contado: Record<string, number>, nota = ''): string | null {
  if (!abierta(s)) return 'La caja ya está cerrada.';
  const t = turnoActual(s);
  t.esperado = esperado(s, t); t.contado = contado; t.cierreNota = nota; t.cierra = now(); return null;
}
export function movimiento(s: S, tipo: 'IN' | 'OUT', medio: string, monto: number, desc: string): string | null {
  if (!abierta(s)) return CERRADA;
  if (!(monto > 0)) return 'El monto debe ser mayor a 0.';
  if (!desc.trim()) return 'Escribí el motivo del movimiento.';
  const t = turnoActual(s);
  if (tipo === 'OUT' && (esperado(s, t)[medio] ?? 0) < monto) return 'No hay saldo suficiente en ese medio.';
  s.movs.push({ id: s.movs.length + 1, turno: t.id, at: now(), tipo, medio, monto, desc: desc.trim(), void: false }); return null;
}
export function anularMov(s: S, id: number): string | null {
  const m = s.movs.find(x => x.id === id);
  if (!m || m.void) return 'El movimiento no existe o ya está anulado.';
  if (!abierta(s) || m.turno !== turnoActual(s).id) return 'Solo se anulan movimientos del turno abierto.';
  m.void = true; return null;
}

/* ───────── Insumos y recetas ───────── */
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function nuevoInsumo(s: S, name: string, unit: string, cost: number, stock: number, min: number): string | null {
  if (!name.trim()) return 'Poné un nombre al insumo.';
  if (s.insumos.some(i => i.name.toLowerCase() === name.trim().toLowerCase())) return 'Ya existe un insumo con ese nombre.';
  if (cost < 0 || stock < 0 || min < 0) return 'Costo, stock y mínimo no pueden ser negativos.';
  s.insumos.push({ id: Math.max(0, ...s.insumos.map(i => i.id)) + 1, name: name.trim(), unit: unit.trim() || 'u', cost, stock, min });
  return null;
}

// Merma: cada insumo puede tener la suya; si no, usa la merma general de la receta
export function costoReceta(s: S, r: Pick<Receta, 'ins' | 'mo' | 'cf' | 'merma' | 'lote'>) {
  let ins = 0, merma = 0;
  for (const l of r.ins) {
    const c = l.qty * (s.insumos.find(i => i.id === l.iid)?.cost ?? 0);
    ins += c; merma += c * (l.merma ?? r.merma) / 100;
  }
  const total = ins + r.mo + r.cf + merma;
  return { ins, mo: r.mo, cf: r.cf, merma, total, unit: r.lote > 0 ? total / r.lote : 0 };
}

// Qué pasa si el costo de un insumo cambia: recetas afectadas, costo unitario y precio sugerido
export function impactoCosto(s: S, iid: number, nuevo: number) {
  const t: S = { ...s, insumos: s.insumos.map(i => i.id === iid ? { ...i, cost: nuevo } : i) };
  return s.recetas.filter(r => r.ins.some(l => l.iid === iid)).map(r => {
    const antes = costoReceta(s, r).unit, despues = costoReceta(t, r).unit, p = prod(s, r.pid);
    const sug = calcPrecio(despues, s.cfg.mv, s.cfg, selDefault)?.lista ?? 0;
    return { id: r.id, name: r.name, antes, despues, precio: p?.price ?? 0, sug,
      margen: p && p.price > 0 ? (p.price - despues) / p.price * 100 : 0 };
  });
}

export function cambiarCostoInsumo(s: S, id: number, cost: number, recalc: boolean): string | null {
  const i = s.insumos.find(x => x.id === id);
  if (!i) return 'El insumo no existe.';
  if (!(cost >= 0)) return 'El costo no puede ser negativo.';
  i.cost = cost;
  const tocados = new Set<number>();
  for (const r of s.recetas) {
    if (!r.ins.some(l => l.iid === id)) continue;
    const p = prod(s, r.pid); if (!p) continue;
    const u = Math.round(costoReceta(s, r).unit * 100) / 100;
    p.cost = u; tocados.add(p.id);
    if (recalc) { const q = calcPrecio(u, s.cfg.mv, s.cfg, selDefault); if (q) p.price = q.lista; }
  }
  recosto(s);
  if (recalc) s.prods.forEach(p => {
    if (p.combo && p.combo.some(c => tocados.has(c.pid))) { const q = calcPrecio(p.cost, s.cfg.mv, s.cfg, selDefault); if (q) p.price = q.lista; }
  });
  return null;
}

export function nuevaReceta(s: S, name: string, lote: number, unidad: string, ins: RLn[], mo: number, cf: number, merma: number): string | null {
  if (!name.trim()) return 'Poné un nombre a la receta.';
  if (!(lote > 0)) return 'La cantidad por lote debe ser mayor a 0.';
  if (!ins.length) return 'Agregá al menos un insumo.';
  if (mo < 0 || cf < 0 || merma < 0 || ins.some(l => (l.merma ?? 0) < 0)) return 'Mano de obra, costos fijos y merma no pueden ser negativos.';
  let p = s.prods.find(x => x.name.toLowerCase() === name.trim().toLowerCase());
  if (p?.combo) return 'Ese nombre corresponde a un combo.';
  if (p && s.recetas.some(r => r.pid === p!.id)) return 'Ya hay una receta para ese producto.';
  const rec = { ins, mo, cf, merma, lote };
  const unit = Math.round(costoReceta(s, rec).unit * 100) / 100;
  if (!p) {
    p = { id: Math.max(0, ...s.prods.map(x => x.id)) + 1, name: name.trim(), stock: 0, min: 0, cost: unit, price: 0 };
    s.prods.push(p);
  }
  if (p.stock === 0) p.cost = unit;
  if (p.price <= 0) p.price = calcPrecio(unit, s.cfg.mv, s.cfg, selDefault)?.lista ?? unit * 2;
  s.recetas.push({ id: Math.max(0, ...s.recetas.map(r => r.id)) + 1, name: name.trim(), lote, unidad: unidad.trim() || 'Unidad', ins, mo, cf, merma, pid: p.id });
  return null;
}

export function fabricar(s: S, rid: number, qty: number, descontar: boolean): string | null {
  const r = s.recetas.find(x => x.id === rid);
  if (!r) return 'Elegí una receta.';
  if (!(qty > 0)) return 'La cantidad a fabricar debe ser mayor a 0.';
  const p = prod(s, r.pid);
  if (!p) return 'El producto de esta receta ya no existe.';
  const k = qty / r.lote;
  if (descontar) for (const l of r.ins) {
    const i = s.insumos.find(x => x.id === l.iid);
    if (!i) return 'Un insumo de la receta ya no existe.';
    if (i.stock < l.qty * k - 1e-9) return `Falta ${i.name}: hay ${i.stock} ${i.unit} y se necesitan ${r3(l.qty * k)}.`;
  }
  const unit = costoReceta(s, r).unit;
  if (descontar) r.ins.forEach(l => { const i = s.insumos.find(x => x.id === l.iid)!; i.stock = Math.max(0, r3(i.stock - l.qty * k)); });
  const tot = p.stock + qty;
  p.cost = Math.round(((p.stock * p.cost + qty * unit) / tot) * 100) / 100; // costo promedio ponderado
  p.stock = tot;
  s.fabs.push({ id: s.fabs.length + 1, rid, qty, at: now(), costoU: Math.round(unit * 100) / 100, desc: descontar });
  recosto(s); return null;
}

export function eliminarReceta(s: S, id: number): string | null {
  s.recetas = s.recetas.filter(r => r.id !== id); return null;
}

/* ───────── Combos / ofertas ───────── */
export function nuevoCombo(s: S, name: string, notes: string, items: { pid: number; qty: number }[], price: number): string | null {
  if (!name.trim()) return 'Poné un nombre al combo.';
  if (!items.length) return 'Agregá productos al combo.';
  if (s.prods.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) return 'Ya existe un producto con ese nombre.';
  const cost = items.reduce((a, l) => a + l.qty * (prod(s, l.pid)?.cost ?? 0), 0);
  const pr = price > 0 ? price : (calcPrecio(cost, s.cfg.mv, s.cfg, selDefault)?.lista ?? cost * 2);
  s.prods.push({ id: Math.max(0, ...s.prods.map(p => p.id)) + 1, name: name.trim(), stock: 0, min: 0, cost: Math.round(cost * 100) / 100,
    price: pr, combo: items.map(i => ({ ...i })), notes: notes.trim() || undefined });
  return null;
}
export function eliminarCombo(s: S, id: number): string | null {
  s.prods = s.prods.filter(p => p.id !== id); return null;
}

/* ───────── Fondos en tránsito (ventas por plataforma) ───────── */
// neto real de una venta = total cobrado − comisión absorbida − comisión trasladada que retiene la pasarela/plataforma
export const neto = (t: Tx) => r2(t.amount - (t.comAbs ?? 0) - (t.comTras ?? 0));
export const enTransito = (t: Tx) => !t.void && t.type === 'SALE' && !!t.libera && +new Date(t.libera) > Date.now();
export const transito = (s: S) => r2(s.txs.filter(enTransito).reduce((a, t) => a + neto(t), 0));
// Simulación: adelanta el paso del tiempo y libera ahora los fondos de una venta
export function liberarAhora(s: S, id: number): string | null {
  if (!abierta(s)) return CERRADA;
  const t = s.txs.find(x => x.id === id);
  if (!t || !enTransito(t)) return 'Esos fondos ya fueron liberados.';
  t.libera = now(); return null;
}

type Cat = 'cobros' | 'compras' | 'gastos';
export function flows(s: S) {
  const o: { d: Date; c: Cat; a: number; m: string }[] = [];
  for (const t of s.txs) {
    if (t.void) continue;
    const d = new Date(t.at), paid = t.status === 'PAID', liq = t.paidBy != null;
    if (t.type === 'SALE' && paid && !liq) {
      if (t.split) t.split.forEach(p => o.push({ d, c: 'cobros', a: p.monto, m: p.medio })); // pago mixto
      else if (t.libera) { const dl = new Date(t.libera); if (+dl <= Date.now()) o.push({ d: dl, c: 'cobros', a: neto(t), m: cuentaDe(s, t.medio) }); } // plataforma: entra al banco recién al liberarse
      else o.push({ d, c: 'cobros', a: neto(t), m: cuentaDe(s, t.medio) }); // ingreso neto real: menos la comisión que retiene la pasarela/plataforma
    }
    else if (t.type === 'COLLECTION') o.push({ d, c: 'cobros', a: t.amount, m: t.medio });
    else if (t.type === 'PAYMENT') o.push({ d, c: s.txs.find(x => x.id === t.pays)?.type === 'PURCHASE' ? 'compras' : 'gastos', a: t.amount, m: t.medio });
    else if (t.type === 'PURCHASE' && paid && !liq) o.push({ d, c: 'compras', a: t.amount, m: t.medio });
    else if (t.type === 'EXPENSE' && paid && !liq) o.push({ d, c: 'gastos', a: t.amount, m: t.medio });
  }
  return o;
}

export function saldos(s: S) {
  let caja = s.caja0, banco = s.banco0;
  for (const f of flows(s)) {
    const x = f.c === 'cobros' ? f.a : -f.a, t = medioTipo(s, f.m);
    if (t === 'caja') caja += x; else if (t === 'banco') banco += x;
  }
  for (const m of s.movs) {
    if (m.void) continue;
    const x = m.tipo === 'IN' ? m.monto : -m.monto, t = medioTipo(s, m.medio);
    if (t === 'caja') caja += x; else if (t === 'banco') banco += x;
  }
  return { caja, banco };
}

export function pyl(s: S, f: (d: Date) => boolean) {
  let v = 0, d = 0, c = 0, g = 0, gc = 0;
  for (const t of s.txs) {
    if (t.void || !f(new Date(t.at))) continue;
    // el recargo trasladado por el medio de pago no es ingreso del negocio: es plata de paso
    // la comisión de plataforma/pasarela que absorbe el comercio (comAbs) va a «gc» (Comisión por Plataforma) y resta del resultado
    if (t.type === 'SALE') { v += t.amount - (t.iva ?? 0) - (t.rec ?? 0) + t.disc; d += t.disc; c += t.costAmt; gc += t.comAbs ?? 0; }
    else if (t.type === 'EXPENSE') g += t.amount - (t.iva ?? 0);
  }
  return { v, d, c, g, gc, vn: v - d, bruta: v - d - c, neta: v - d - c - g - gc };
}

export const por = (s: S, tipos: Tipo[]) => s.txs.filter(t => !t.void && t.status === 'PENDING' && tipos.includes(t.type));

export function seed(): S {
  const s: S = { seq: 0, cfg: cfgDefault(), neg: { nombre: '', cuit: '', tel: '', dir: '', email: '' }, caja0: 60000, banco0: 600000, txs: [],
    turnos: [], movs: [],
    contactos: [
      { id: 1, tipo: 'CLI', name: 'Oficina García', doc: '30-71234567-8', tel: '351 555-0101', email: '', dir: '' },
      { id: 2, tipo: 'CLI', name: 'Estudio Pérez', doc: '20-23456789-3', tel: '351 555-0102', email: '', dir: '' },
      { id: 3, tipo: 'PROV', name: 'Distribuidora Sur', doc: '30-65432109-5', tel: '351 555-0201', email: '', dir: '' },
      { id: 4, tipo: 'PROV', name: 'Inmobiliaria Centro', doc: '30-11223344-6', tel: '351 555-0202', email: '', dir: '' },
      { id: 5, tipo: 'CLI', name: 'Café del Parque', doc: '', tel: '351 555-0103', email: 'hola@cafedelparque.com', dir: '' }],
    insumos: [
      { id: 1, name: 'Harina 000', unit: 'kg', stock: 25, min: 10, cost: 900 },
      { id: 2, name: 'Manteca', unit: 'kg', stock: 8, min: 3, cost: 7500 },
      { id: 3, name: 'Azúcar', unit: 'kg', stock: 12, min: 5, cost: 1100 }],
    recetas: [{ id: 1, name: 'Medialuna', lote: 12, unidad: 'Unidad', pid: 1, mo: 2000, cf: 500, merma: 5,
      ins: [{ iid: 1, qty: 0.6 }, { iid: 2, qty: 0.3, merma: 8 }, { iid: 3, qty: 0.05 }] }],
    fabs: [], envios: [],
    medios: [{ name: 'Efectivo', tipo: 'caja' }, { name: 'Mercado Pago', tipo: 'banco' },
      { name: 'Transferencia Bancaria', tipo: 'banco', com: 0 }, { name: 'Fiado / Cta Corriente', tipo: 'credito' }],
    prods: [
      { id: 1, name: 'Medialuna', stock: 36, min: 12, cost: 350, price: 900 },
      { id: 2, name: 'Tostado J&Q', stock: 15, min: 6, cost: 1600, price: 4200 },
      { id: 3, name: 'Café con leche', stock: 50, min: 15, cost: 700, price: 2800 },
      { id: 4, name: 'Alfajor', stock: 30, min: 10, cost: 700, price: 1300 },
      { id: 5, name: 'Gaseosa 500ml', stock: 10, min: 12, cost: 1100, price: 2000 },
      { id: 6, name: 'Agua mineral 500ml', stock: 24, min: 12, cost: 600, price: 1400 }] };
  const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  s.turnos.push({ id: 1, abre: ago(100), nota: 'Apertura inicial', inicial: { Efectivo: s.caja0, 'Mercado Pago': s.banco0 } });
  gasto(s, [{ cat: 'Alquiler', desc: 'Alquiler del local', monto: 350000 }], 'Transferencia Bancaria', 'PAID', undefined, 'Inmobiliaria Centro', 0, false, ago(48));
  compra(s, [{ pid: 4, qty: 24, cost: 700 }], 'Fiado / Cta Corriente', 'PENDING', day(10), 'Distribuidora Sur', 21, false, ago(24));
  venta(s, { 2: 5, 3: 5 }, 'Fiado / Cta Corriente', 'PENDING', day(-1), 'Oficina García', 0, ago(72));
  venta(s, { 3: 2, 1: 4 }, 'Efectivo', 'PAID', undefined, '', 0, ago(26));
  venta(s, { 3: 1, 1: 2 }, 'Efectivo', 'PAID', undefined, '', 0, ago(5));
  venta(s, { 2: 2, 6: 2 }, 'Mercado Pago', 'PAID', undefined, '', 0, ago(4));
  venta(s, { 3: 2 }, '', 'PAID', undefined, 'Venta online de ejemplo', 0, ago(30), 0, false, undefined, 0, 1, 1); // MercadoLibre → fondos en tránsito
  venta(s, { 5: 3, 4: 3 }, 'Efectivo', 'PAID', undefined, '', 0, ago(3));
  venta(s, { 3: 4, 1: 6 }, 'Fiado / Cta Corriente', 'PENDING', day(7), 'Estudio Pérez', 0, ago(2));
  gasto(s, [{ cat: 'Servicios', desc: 'Luz y gas', monto: 18500 }], 'Efectivo', 'PAID', undefined, '', 21, true, ago(1));
  // Demo de marketing: cliente que dejó de venir (inactivo + aviso de recompra)
  venta(s, { 1: 3 }, 'Efectivo', 'PAID', undefined, 'Café del Parque', 0, ago(24 * 75));
  venta(s, { 1: 3 }, 'Efectivo', 'PAID', undefined, 'Café del Parque', 0, ago(24 * 70));
  s.txs.forEach(t => { const c = s.contactos.find(k => t.desc.includes(k.name) || t.prov === k.name); if (c) t.cid = c.id; });
  s.contactos[0].cumple = new Date(Date.now() + 3 * 864e5 - 30 * 365 * 864e5).toISOString().slice(0, 10); // cumple en ~3 días
  return s;
}

export function ivaRes(s: S, f: (d: Date) => boolean) {
  let deb = 0, cred = 0;
  for (const t of s.txs) {
    if (t.void || !f(new Date(t.at))) continue;
    if (t.type === 'SALE') deb += t.iva ?? 0; else if (t.type === 'PURCHASE' || t.type === 'EXPENSE') cred += t.iva ?? 0;
  }
  return { deb, cred };
}

export type Neg = { nombre: string; cuit: string; tel: string; dir: string; email: string };
export type Cfg = { packaging: number; envio: number; comision: number; iibb: number; retenciones: number; redTipo: string; redMult: number;
  pasarelas: { name: string; pct: number }[]; plataformas: { name: string; pct: number; dias?: number }[]; cuotas: Record<number, number[]>; // dias = días estimados de liberación de fondos
  mv: number; mm: number; desc: number;
  mgOk: number; mgBajo: number;            // semáforo de rentabilidad (margen %)
  trasladaCom: boolean;                    // comisión de pasarela/plataforma/medio de pago: la paga el cliente
  trasladaCuotas: boolean;                 // recargo por cuotas: lo paga el cliente
  demoraFondos: boolean;                   // simular demora en la liberación de fondos de las plataformas
  bloqueaMin: boolean;                     // bloquear ventas de productos bajo el stock mínimo
  fid: Fid; happy: HH[]; camp: Camp };     // marketing: puntos · Happy Hour · parámetros de campañas
export const REDONDEOS = ['Ninguno', 'Múltiplo', 'Psicológico (990/999)'];
export const CUOTAS = [2, 3, 6, 12];
export function cfgDefault(): Cfg {
  return { packaging: 100, envio: 200, comision: 5, iibb: 3, retenciones: 2, redTipo: REDONDEOS[2], redMult: 10,
    pasarelas: [{ name: 'Mercado Pago', pct: 7 }, { name: 'PayU', pct: 3.5 }, { name: 'Stripe', pct: 2.9 }],
    plataformas: [{ name: 'MercadoLibre', pct: 4, dias: 10 }, { name: 'Tienda Nube', pct: 3, dias: 14 }, { name: 'Shopify', pct: 2, dias: 2 }], // días: valores de ejemplo, editalos en Configuración
    cuotas: { 2: [11, 7, 9], 3: [15, 12, 16], 6: [30, 27, 32], 12: [70, 60, 68] }, mv: 30, mm: 15, desc: 0,
    mgOk: 30, mgBajo: 15, trasladaCom: false, trasladaCuotas: false, bloqueaMin: false, demoraFondos: true,
    fid: { activo: true, pesos: 100, valor: 5 },
    happy: [{ id: 1, name: 'Happy Hour panadería', activo: false, dias: [1, 2, 3, 4, 5], desde: '18:00', hasta: '20:00', pct: 20, pids: [1] }],
    camp: { diasCumple: 7, diasRecompra: 15, minCompras: 2, diasInactivo: 60, ofertaPct: 10 } };
}
export type Sel = { pack: boolean; envio: boolean; com: boolean; iibb: boolean; ret: boolean; pas: number; plat: number; desc: number };
export const selDefault: Sel = { pack: false, envio: false, com: false, iibb: true, ret: true, pas: 0, plat: 0, desc: 0 };

export function redondear(p: number, c: Cfg) {
  const m = Math.max(c.redMult, 1);
  if (c.redTipo === 'Múltiplo') return Math.ceil(p / m) * m;
  if (c.redTipo.startsWith('Psicol')) return p < 1000 ? Math.ceil(p / m) * m : Math.ceil((p + m) / 1000) * 1000 - m;
  return Math.round(p * 100) / 100;
}

// Cargos de una venta. El 3er valor indica si lo paga el cliente (trasladado) en vez del comercio.
function cargos(c: Cfg, sel: Sel, cuotas: number, pas: number) {
  const fijos: [string, number][] = [];
  if (sel.pack) fijos.push(['Packaging', c.packaging]);
  if (sel.envio) fijos.push(['Envío', c.envio]);
  const pa = pas ? c.pasarelas[pas - 1] : null, pl = sel.plat ? c.plataformas[sel.plat - 1] : null;
  const pcts: [string, number, boolean][] = [
    ['Comisión vendedor', sel.com ? c.comision : 0, false], ['Ingresos Brutos', sel.iibb ? c.iibb : 0, false], ['Retenciones', sel.ret ? c.retenciones : 0, false],
    [pa ? `Pasarela (${pa.name})` : 'Pasarela', pa ? pa.pct : 0, c.trasladaCom],
    ['Recargo por cuotas', pa && cuotas > 1 ? (c.cuotas[cuotas]?.[pas - 1] ?? 0) : 0, c.trasladaCuotas],
    [pl ? `Plataforma (${pl.name})` : 'Plataforma', pl ? pl.pct : 0, c.trasladaCom]];
  return { fijos, pcts };
}

// Margen sobre el PRECIO FINAL: precio = (costo + fijos) / (1 − margen% − % que absorbe el comercio)
// Los cargos trasladados no entran en el precio de lista: se suman al ticket del cliente.
export function calcPrecio(costo: number, margen: number, c: Cfg, sel: Sel, cuotas = 1, pas = sel.pas) {
  const { fijos, pcts } = cargos(c, sel, cuotas, pas);
  const absorbe = pcts.filter(p => !p[2]).reduce((a, p) => a + p[1], 0);
  const traslada = Math.min(pcts.filter(p => p[2]).reduce((a, p) => a + p[1], 0), 95);
  const den = 1 - (margen + absorbe) / 100;
  if (den <= 0.01) return null;
  const base = costo + fijos.reduce((a, [, x]) => a + x, 0), d = Math.min(sel.desc || 0, 99);
  const lista = redondear(base / den / (1 - d / 100), c), final = lista * (1 - d / 100);
  const cliente = traslada ? r2(final / (1 - traslada / 100)) : final;
  const ded = pcts.filter(p => p[1]).map(([n, x, t]) => [n, (t ? cliente : final) * x / 100, x, t] as [string, number, number, boolean]);
  const ganancia = final - base - ded.filter(x => !x[3]).reduce((a, x) => a + x[1], 0);
  return { costo, fijos, base, lista, final, cliente, recargo: cliente - final, d, descMonto: lista - final, ded, ganancia, real: final ? ganancia / final * 100 : 0 };
}

// Simulador inverso: con un precio de venta impuesto por el mercado, devuelve ganancia y margen real.
export function calcInverso(costo: number, precio: number, c: Cfg, sel: Sel, cuotas = 1, pas = sel.pas) {
  if (!(precio > 0) || !(costo >= 0)) return null;
  const { fijos, pcts } = cargos(c, sel, cuotas, pas);
  const base = costo + fijos.reduce((a, [, x]) => a + x, 0), d = Math.min(sel.desc || 0, 99);
  const final = precio * (1 - d / 100);
  const traslada = Math.min(pcts.filter(p => p[2]).reduce((a, p) => a + p[1], 0), 95);
  const cliente = traslada ? r2(final / (1 - traslada / 100)) : final;
  const ded = pcts.filter(p => p[1]).map(([n, x, t]) => [n, (t ? cliente : final) * x / 100, x, t] as [string, number, number, boolean]);
  const ganancia = final - base - ded.filter(x => !x[3]).reduce((a, x) => a + x[1], 0);
  return { costo, fijos, base, lista: precio, final, cliente, recargo: cliente - final, d, descMonto: precio - final, ded, ganancia,
    real: final ? ganancia / final * 100 : 0, markup: base > 0 ? ganancia / base * 100 : 0 };
}

/* ───────── Clientes y proveedores ───────── */
export type Contacto = { id: number; tipo: 'CLI' | 'PROV'; name: string; doc: string; tel: string; email: string; dir: string; cumple?: string };
const tiposDe = (c: Contacto): Tipo[] => (c.tipo === 'CLI' ? ['SALE'] : ['PURCHASE', 'EXPENSE']);
export const pendientesDe = (s: S, c: Contacto) => s.txs.filter(t => t.cid === c.id && !t.void && t.status === 'PENDING' && tiposDe(c).includes(t.type));
export const saldoContacto = (s: S, c: Contacto) => r2(pendientesDe(s, c).reduce((a, t) => a + saldo(s, t), 0));

export function nuevoContacto(s: S, tipo: 'CLI' | 'PROV', name: string, doc: string, tel: string, email: string, dir: string, cumple = ''): string | null {
  if (!name.trim()) return 'Poné un nombre.';
  if (s.contactos.some(c => c.tipo === tipo && c.name.toLowerCase() === name.trim().toLowerCase())) return 'Ya existe un contacto con ese nombre.';
  if (doc.trim() && s.contactos.some(c => c.tipo === tipo && c.doc.replace(/\D/g, '') === doc.replace(/\D/g, '') && doc.replace(/\D/g, ''))) return 'Ya existe un contacto con ese CUIT/DNI.';
  s.contactos.push({ id: Math.max(0, ...s.contactos.map(c => c.id)) + 1, tipo, name: name.trim(), doc: doc.trim(), tel: tel.trim(), email: email.trim(), dir: dir.trim(), cumple: cumple || undefined });
  return null;
}
export function eliminarContacto(s: S, id: number): string | null {
  if (s.txs.some(t => t.cid === id && !t.void)) return 'No se puede eliminar: tiene operaciones registradas.';
  s.contactos = s.contactos.filter(c => c.id !== id); return null;
}
// Vincula la última operación registrada con un contacto (se llama justo después de venta / compra / gasto)
export function vincular(s: S, cid: number) {
  if (cid > 0) { const t = s.txs[s.txs.length - 1]; if (t) t.cid = cid; }
}
// Cobra / paga a cuenta de un contacto: aplica el monto a los comprobantes más viejos primero (monto vacío = todo)
export function liquidarContacto(s: S, cid: number, medio: string, monto?: number): string | null {
  const c = s.contactos.find(x => x.id === cid);
  if (!c) return 'El contacto no existe.';
  const pend = pendientesDe(s, c).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || a.id - b.id);
  const total = r2(pend.reduce((a, t) => a + saldo(s, t), 0));
  if (!(total > 0)) return 'No hay saldo pendiente.';
  let rest = monto == null ? total : r2(monto);
  if (!(rest > 0)) return 'El monto debe ser mayor a 0.';
  if (rest > total + 0.005) return `El monto supera el saldo pendiente (${money(total)}).`;
  for (const t of pend) {
    if (rest <= 0.004) break;
    const pay = Math.min(rest, saldo(s, t));
    const e = liquidar(s, t.id, medio, pay); if (e) return e;
    rest = r2(rest - pay);
  }
  return null;
}

/* ═════════════════ MARKETING Y FIDELIZACIÓN ═════════════════
   Modelo de datos
   · Cfg.fid    { activo, pesos, valor }   → 1 punto cada «pesos» $ · cada punto canjea «valor» $
   · Cfg.happy  HH[]                        → reglas de descuento por franja horaria
   · Cfg.camp   Camp                        → parámetros de campañas (cumpleaños, recompra, inactivos)
   · Contacto.cumple  'YYYY-MM-DD'          → fecha de cumpleaños (opcional)
   · Tx.hh / ptsGan / ptsUsa / ptsDesc      → descuento Happy Hour, puntos ganados / usados, $ descontados por puntos
   · Item.hh                                → % de Happy Hour aplicado a esa línea
   · S.envios   Envio[]                     → bitácora de mensajes enviados (evita repetir avisos)
   El saldo de puntos NO se guarda: se deriva de las ventas (puntosDe), así anular una venta revierte los puntos solo. */

export type Fid = { activo: boolean; pesos: number; valor: number };
export type HH = { id: number; name: string; activo: boolean; dias: number[]; desde: string; hasta: string; pct: number; pids: number[] }; // dias: 0=domingo … 6=sábado · pids vacío = todos los productos
export type Camp = { diasCumple: number; diasRecompra: number; minCompras: number; diasInactivo: number; ofertaPct: number };
export type Envio = { id: number; cid: number; tipo: 'CUMPLE' | 'RECOMPRA' | 'REACT'; ref: string; at: string };

/* ───────── 5. Happy Hour ───────── */
const hm = (x: string) => { const [h, m] = x.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const hhRegla = (r: HH, d: Date) => {
  if (!r.activo || !(r.pct > 0) || !r.dias.includes(d.getDay())) return false;
  const m = d.getHours() * 60 + d.getMinutes(), a = hm(r.desde), z = hm(r.hasta);
  return a <= z ? m >= a && m < z : m >= a || m < z; // admite franjas que cruzan la medianoche
};
// % de descuento automático de un producto en ese momento (si varias reglas coinciden, gana la mayor)
export const hhPct = (s: S, pid: number, d = new Date()) =>
  Math.min(90, Math.max(0, ...s.cfg.happy.filter(r => hhRegla(r, d) && (!r.pids.length || r.pids.includes(pid))).map(r => r.pct)));

/* ───────── 1. Puntos ───────── */
export const puntosGanados = (s: S, monto: number) => { const f = s.cfg.fid; return f.activo && f.pesos > 0 ? Math.floor(monto / f.pesos) : 0; };
// Los puntos se acreditan con la venta pagada (el fiado suma recién al cobrarse) y se restan los canjeados
export const puntosDe = (s: S, cid: number) => Math.max(0, s.txs.reduce((a, t) =>
  t.cid === cid && !t.void && t.type === 'SALE' ? a + (t.status === 'PAID' ? t.ptsGan ?? 0 : 0) - (t.ptsUsa ?? 0) : a, 0));

// Todos los descuentos de un ticket en orden: Happy Hour → % manual → canje de puntos. Lo usan la UI y venta() para que coincidan.
export function descuentos(s: S, cart: Record<number, number>, pct: number, canje: number, cid: number, d = new Date()) {
  let bruto = 0, hh = 0;
  for (const [id, q] of Object.entries(cart)) {
    const p = prod(s, +id); if (!p) continue;
    bruto += q * p.price; hh += q * p.price * hhPct(s, +id, d) / 100;
  }
  hh = r2(hh);
  const man = Math.round((bruto - hh) * Math.min(Math.max(pct || 0, 0), 100)) / 100;
  const f = s.cfg.fid, resto = r2(bruto - hh - man);
  const maxPts = f.activo && cid > 0 && f.valor > 0 ? Math.max(0, Math.min(puntosDe(s, cid), Math.floor(resto / f.valor))) : 0;
  let pts = 0, err: string | null = null;
  if (canje > 0) {
    if (!f.activo || cid <= 0) err = 'Para canjear puntos elegí un cliente y activá la fidelización.';
    else if (!Number.isInteger(canje) || canje > maxPts) err = `Podés canjear hasta ${maxPts} puntos en este ticket.`;
    else pts = r2(canje * f.valor);
  }
  return { bruto, hh, man, pts, maxPts, neto: r2(resto - pts), err };
}

/* ───────── 2. Recomendación cruzada ───────── */
export type Sug = { p: Prod; score: number; motivo: string; tipo: 'cli' | 'fav' | 'glob' };
export function sugerencias(s: S, cart: number[], cid: number, max = 3): Sug[] {
  const glob: Record<number, number> = {}, cli: Record<number, number> = {}, fav: Record<number, number> = {};
  for (const t of s.txs) {
    if (t.void || t.type !== 'SALE') continue;
    const ids = [...new Set(t.items.map(i => i.pid))], propia = cid > 0 && t.cid === cid;
    if (propia) ids.forEach(id => { fav[id] = (fav[id] ?? 0) + 1; });
    if (cart.length && ids.some(id => cart.includes(id)))
      ids.filter(id => !cart.includes(id)).forEach(id => { glob[id] = (glob[id] ?? 0) + 1; if (propia) cli[id] = (cli[id] ?? 0) + 1; });
  }
  return s.prods.filter(p => !cart.includes(p.id) && stk(s, p) > 0 && !(s.cfg.bloqueaMin && stk(s, p) < p.min)).map(p => {
    const c = cli[p.id] ?? 0, g = glob[p.id] ?? 0, f = fav[p.id] ?? 0;
    const score = c * 3 + g + (cart.length ? (f >= 2 ? 1 : 0) : f * 3);
    const tipo: Sug['tipo'] = c > 0 ? 'cli' : (f >= 2 || (!cart.length && f > 0)) ? 'fav' : 'glob';
    const motivo = tipo === 'cli' ? `lo llevó junto en ${c} compra(s)` : tipo === 'fav' ? `lo compró ${f} vez/veces` : `va junto en ${g} venta(s) del local`;
    return { p, score, motivo, tipo };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}

/* ───────── 3 y 4. Campañas: cumpleaños, recompra, inactivos ───────── */
const diasDesde = (iso: string) => Math.floor((Date.now() - +new Date(iso)) / 864e5);
export const ventasDe = (s: S, cid: number) => s.txs.filter(t => t.cid === cid && !t.void && t.type === 'SALE');
export const ultimaCompra = (s: S, cid: number) => { const v = ventasDe(s, cid); return v.length ? v.reduce((m, t) => (t.at > m ? t.at : m), v[0].at) : null; };
export const diasSinComprar = (s: S, cid: number) => { const u = ultimaCompra(s, cid); return u ? diasDesde(u) : null; };

// días hasta el próximo cumpleaños (0 = hoy); null si no cargaron la fecha
export function proxCumple(c: Contacto, hoy = new Date()) {
  if (!c.cumple) return null;
  const [, m, d] = c.cumple.split('-').map(Number); if (!m || !d) return null;
  const h0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  let f = new Date(hoy.getFullYear(), m - 1, d); if (f < h0) f = new Date(hoy.getFullYear() + 1, m - 1, d);
  return Math.round((+f - +h0) / 864e5);
}

export type Aviso = { cid: number; tipo: Envio['tipo']; ref: string; dias: number; prod?: string };
// Cola de mensajes automáticos pendientes (cumpleaños próximos + recompra de productos frecuentes), sin repetir los ya enviados
export function avisos(s: S, hoy = new Date()): Aviso[] {
  const cp = s.cfg.camp, out: Aviso[] = [];
  const hecho = (cid: number, tipo: Envio['tipo'], ref: string) => s.envios.some(e => e.cid === cid && e.tipo === tipo && e.ref === ref);
  for (const c of s.contactos) {
    if (c.tipo !== 'CLI') continue;
    const pc = proxCumple(c, hoy);
    if (pc != null && pc <= cp.diasCumple) {
      const ref = String(new Date(+hoy + pc * 864e5).getFullYear());
      if (!hecho(c.id, 'CUMPLE', ref)) out.push({ cid: c.id, tipo: 'CUMPLE', ref, dias: pc });
    }
    const h = new Map<number, { n: number; last: string; name: string }>();
    for (const t of ventasDe(s, c.id)) {
      const vistos = new Set<number>();
      for (const i of t.items) {
        if (vistos.has(i.pid)) continue; vistos.add(i.pid);
        const o = h.get(i.pid) ?? { n: 0, last: t.at, name: i.name };
        o.n++; if (t.at > o.last) o.last = t.at; h.set(i.pid, o);
      }
    }
    h.forEach((o, pid) => {
      const p = prod(s, pid), ref = `${pid}@${o.last}`;
      if (p && stk(s, p) > 0 && o.n >= cp.minCompras && diasDesde(o.last) >= cp.diasRecompra && !hecho(c.id, 'RECOMPRA', ref))
        out.push({ cid: c.id, tipo: 'RECOMPRA', ref, dias: diasDesde(o.last), prod: o.name });
    });
  }
  return out;
}

export function inactivos(s: S, dias: number) {
  return s.contactos.filter(c => c.tipo === 'CLI').map(c => ({ c, d: diasSinComprar(s, c.id), gastado: r2(ventasDe(s, c.id).reduce((a, t) => a + t.amount, 0)) }))
    .filter(x => x.d != null && x.d >= dias).sort((a, b) => (b.d as number) - (a.d as number)) as { c: Contacto; d: number; gastado: number }[];
}

export const PLANTILLA_REACT = 'Hola {nombre}, ¡te extrañamos en {negocio}! Hace {dias} días que no nos visitás. Con este mensaje tenés {oferta}% de descuento en tu próxima compra. ¡Te esperamos!';
export function mensaje(s: S, a: Aviso, oferta = s.cfg.camp.ofertaPct, plantilla = PLANTILLA_REACT) {
  const n = s.contactos.find(x => x.id === a.cid)?.name ?? '', neg = s.neg.nombre || 'nuestro local';
  if (a.tipo === 'CUMPLE') return `¡Feliz cumpleaños, ${n}! 🎂 Todo el equipo de ${neg} te desea un día genial. ¡Pasá a festejar con nosotros!`;
  if (a.tipo === 'RECOMPRA') return `Hola ${n}, ¿cómo estás? Hace ${a.dias} días que no te llevás ${a.prod}. ¿Te guardamos uno? Te esperamos en ${neg}. 😉`;
  return plantilla.replace(/\{nombre\}/g, n).replace(/\{negocio\}/g, neg).replace(/\{dias\}/g, String(a.dias)).replace(/\{oferta\}/g, String(oferta));
}

export function marcarEnviado(s: S, items: { cid: number; tipo: Envio['tipo']; ref: string }[]): string | null {
  if (!items.length) return 'No hay clientes seleccionados.';
  items.forEach(x => s.envios.push({ id: s.envios.length + 1, ...x, at: now() }));
  return null;
}

/* ───────── Contenido comercial y SEO (IA) ───────── */
export function guardarContenido(s: S, pid: number, desc: string, seo: Seo): string | null {
  const p = s.prods.find(x => x.id === pid);
  if (!p) return 'El producto ya no existe.';
  if (seo.titulo.length > 60 || seo.descripcion.length > 155) return 'El título SEO admite 60 caracteres y la descripción 155.';
  p.desc = desc || undefined; p.seo = seo.titulo ? seo : undefined; return null;
}
