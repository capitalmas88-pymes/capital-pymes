export type Tipo = 'SALE' | 'PURCHASE' | 'EXPENSE' | 'COLLECTION' | 'PAYMENT';
export type St = 'PAID' | 'PENDING';
export type Prod = { id: number; name: string; stock: number; min: number; cost: number; price: number };
export type Medio = { name: string; tipo: 'caja' | 'banco' | 'credito' };
export type Item = { pid: number; name: string; qty: number; price: number; cost: number };
export type Tx = { id: number; type: Tipo; desc: string; amount: number; costAmt: number; medio: string; status: St;
  due?: string; at: string; items: Item[]; void: boolean; paidBy?: number; pays?: number; disc: number; iva?: number; prov?: string };
export type S = { prods: Prod[]; txs: Tx[]; medios: Medio[]; caja0: number; banco0: number; seq: number; cfg: Cfg; neg: Neg };

export const money = (v: number) => (v < 0 ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('es-AR');
const now = () => new Date().toISOString();
export const medioTipo = (s: S, n: string) => s.medios.find(m => m.name === n)?.tipo ?? 'banco';
const prod = (s: S, id: number) => s.prods.find(p => p.id === id);
function push(s: S, t: Omit<Tx, 'id' | 'void'>, due?: string) {
  if (medioTipo(s, t.medio) === 'credito' && t.type !== 'COLLECTION' && t.type !== 'PAYMENT') t.status = 'PENDING';
  const x: Tx = { ...t, id: ++s.seq, void: false, due: t.status === 'PENDING' ? due : undefined };
  s.txs.push(x); return x;
}

export type Ln = { pid: number; qty: number; cost: number };
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
  nota = '', pct = 0, at = now(), ivaPct = 0, ivaInc = false): string | null {
  const ids = Object.keys(cart).map(Number);
  if (!ids.length) return 'El ticket está vacío.';
  for (const id of ids) {
    const p = prod(s, id);
    if (!p) return 'Un producto del ticket ya no existe.';
    if (p.stock < cart[id]) return `Stock insuficiente de ${p.name} (hay ${p.stock}).`;
  }
  const items: Item[] = []; let bruto = 0, costo = 0;
  for (const id of ids) {
    const p = prod(s, id)!, q = cart[id];
    items.push({ pid: id, name: p.name, qty: q, price: p.price, cost: p.cost });
    bruto += q * p.price; costo += q * p.cost; p.stock -= q;
  }
  const disc = Math.round(bruto * Math.min(Math.max(pct, 0), 100)) / 100;
  const { total, iva } = calcIva(bruto - disc, ivaPct, ivaInc);
  push(s, { type: 'SALE', desc: items.map(i => `${i.qty}× ${i.name}`).join(', ') + (disc ? ` (desc. ${pct}%)` : '') + sfx(ivaPct, iva, ivaInc, '') + (nota ? ` — ${nota}` : ''),
    amount: total, costAmt: costo, medio, status: st, at, items, disc, iva }, due);
  return null;
}

export function compra(s: S, lines: Ln[], medio: string, st: St, due: string | undefined, prov = '',
  ivaPct = 0, ivaInc = false, at = now()): string | null {
  if (!lines.length) return 'El detalle de la compra está vacío.';
  for (const l of lines) {
    if (!prod(s, l.pid)) return 'Producto inexistente.';
    if (l.qty <= 0 || l.cost < 0) return 'Cantidad y costo deben ser válidos.';
  }
  const f = ivaInc && ivaPct ? 1 / (1 + ivaPct / 100) : 1; // el costo del producto se guarda sin IVA
  const items: Item[] = []; let sum = 0;
  for (const l of lines) {
    const p = prod(s, l.pid)!, cn = l.cost * f, tot = p.stock + l.qty;
    p.cost = Math.round(((p.stock * p.cost + l.qty * cn) / tot) * 100) / 100; // costo promedio ponderado
    p.stock = tot; sum += l.qty * l.cost;
    items.push({ pid: p.id, name: p.name, qty: l.qty, price: 0, cost: Math.round(cn * 100) / 100 });
  }
  const { total, iva } = calcIva(sum, ivaPct, ivaInc);
  push(s, { type: 'PURCHASE', desc: items.map(i => `${i.qty}× ${i.name}`).join(', ') + ' (compra)' + sfx(ivaPct, iva, ivaInc, prov),
    amount: total, costAmt: 0, medio, status: st, at, items, disc: 0, iva, prov: prov || undefined }, due);
  return null;
}

export function gasto(s: S, lines: GLn[], medio: string, st: St, due: string | undefined, prov = '',
  ivaPct = 0, ivaInc = false, at = now()): string | null {
  if (!lines.length || lines.some(l => !(l.monto > 0))) return 'Cargá al menos un gasto con monto mayor a 0.';
  const { total, iva } = calcIva(lines.reduce((a, l) => a + l.monto, 0), ivaPct, ivaInc);
  push(s, { type: 'EXPENSE', desc: lines.map(l => (l.desc ? `${l.cat}: ${l.desc}` : l.cat)).join(' + ') + sfx(ivaPct, iva, ivaInc, prov),
    amount: total, costAmt: 0, medio, status: st, at, items: [], disc: 0, iva, prov: prov || undefined }, due);
  return null;
}

export function liquidar(s: S, id: number, medio: string): string | null {
  const o = s.txs.find(t => t.id === id);
  if (!o || o.void || o.status !== 'PENDING') return 'Esa cuenta ya no está pendiente.';
  const cobro = o.type === 'SALE';
  const n = push(s, { type: cobro ? 'COLLECTION' : 'PAYMENT', desc: `${cobro ? 'Cobro' : 'Pago'} de #${o.id} · ${o.desc}`,
    amount: o.amount, costAmt: 0, medio, status: 'PAID', at: now(), items: [], pays: o.id, disc: 0 });
  o.status = 'PAID'; o.paidBy = n.id; return null;
}

export function anular(s: S, id: number): string | null {
  const t = s.txs.find(x => x.id === id);
  if (!t || t.void) return 'La operación no existe o ya está anulada.';
  if (t.paidBy) return `Primero anulá el cobro/pago #${t.paidBy} que la liquidó.`;
  if (t.type === 'SALE') t.items.forEach(i => { const p = prod(s, i.pid); if (p) p.stock += i.qty; });
  else if (t.type === 'PURCHASE') t.items.forEach(i => { const p = prod(s, i.pid); if (p) p.stock = Math.max(0, p.stock - i.qty); });
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

type Cat = 'cobros' | 'compras' | 'gastos';
export function flows(s: S) {
  const o: { d: Date; c: Cat; a: number; m: string }[] = [];
  for (const t of s.txs) {
    if (t.void) continue;
    const d = new Date(t.at), paid = t.status === 'PAID', liq = t.paidBy != null;
    if (t.type === 'COLLECTION' || (t.type === 'SALE' && paid && !liq)) o.push({ d, c: 'cobros', a: t.amount, m: t.medio });
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
  return { caja, banco };
}

export function pyl(s: S, f: (d: Date) => boolean) {
  let v = 0, d = 0, c = 0, g = 0;
  for (const t of s.txs) {
    if (t.void || !f(new Date(t.at))) continue;
    if (t.type === 'SALE') { v += t.amount - (t.iva ?? 0) + t.disc; d += t.disc; c += t.costAmt; }
    else if (t.type === 'EXPENSE') g += t.amount - (t.iva ?? 0);
  }
  return { v, d, c, g, vn: v - d, bruta: v - d - c, neta: v - d - c - g };
}

export const por = (s: S, tipos: Tipo[]) => s.txs.filter(t => !t.void && t.status === 'PENDING' && tipos.includes(t.type));

export function seed(): S {
  const s: S = { seq: 0, cfg: cfgDefault(), neg: { nombre: '', cuit: '', tel: '', dir: '', email: '' }, caja0: 60000, banco0: 600000, txs: [],
    medios: [{ name: 'Efectivo', tipo: 'caja' }, { name: 'Mercado Pago', tipo: 'banco' },
      { name: 'Transferencia Bancaria', tipo: 'banco' }, { name: 'Fiado / Cta Corriente', tipo: 'credito' }],
    prods: [
      { id: 1, name: 'Medialuna', stock: 36, min: 12, cost: 350, price: 900 },
      { id: 2, name: 'Tostado J&Q', stock: 15, min: 6, cost: 1600, price: 4200 },
      { id: 3, name: 'Café con leche', stock: 50, min: 15, cost: 700, price: 2800 },
      { id: 4, name: 'Alfajor', stock: 30, min: 10, cost: 700, price: 1300 },
      { id: 5, name: 'Gaseosa 500ml', stock: 10, min: 12, cost: 1100, price: 2000 },
      { id: 6, name: 'Agua mineral 500ml', stock: 24, min: 12, cost: 600, price: 1400 }] };
  const ago = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
  const day = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  gasto(s, [{ cat: 'Alquiler', desc: 'Alquiler del local', monto: 350000 }], 'Transferencia Bancaria', 'PAID', undefined, 'Inmobiliaria Centro', 0, false, ago(48));
  compra(s, [{ pid: 4, qty: 24, cost: 700 }], 'Fiado / Cta Corriente', 'PENDING', day(10), 'Distribuidora Sur', 21, false, ago(24));
  venta(s, { 2: 5, 3: 5 }, 'Fiado / Cta Corriente', 'PENDING', day(-1), 'Oficina García', 0, ago(72));
  venta(s, { 3: 2, 1: 4 }, 'Efectivo', 'PAID', undefined, '', 0, ago(26));
  venta(s, { 3: 1, 1: 2 }, 'Efectivo', 'PAID', undefined, '', 0, ago(5));
  venta(s, { 2: 2, 6: 2 }, 'Mercado Pago', 'PAID', undefined, '', 0, ago(4));
  venta(s, { 5: 3, 4: 3 }, 'Efectivo', 'PAID', undefined, '', 0, ago(3));
  venta(s, { 3: 4, 1: 6 }, 'Fiado / Cta Corriente', 'PENDING', day(7), 'Estudio Pérez', 0, ago(2));
  gasto(s, [{ cat: 'Servicios', desc: 'Luz y gas', monto: 18500 }], 'Efectivo', 'PAID', undefined, '', 21, true, ago(1));
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
  pasarelas: { name: string; pct: number }[]; plataformas: { name: string; pct: number }[]; cuotas: Record<number, number[]>;
  mv: number; mm: number; desc: number };
export const REDONDEOS = ['Ninguno', 'Múltiplo', 'Psicológico (990/999)'];
export const CUOTAS = [2, 3, 6, 12];
export function cfgDefault(): Cfg {
  return { packaging: 100, envio: 200, comision: 5, iibb: 3, retenciones: 2, redTipo: REDONDEOS[2], redMult: 10,
    pasarelas: [{ name: 'Mercado Pago', pct: 7 }, { name: 'PayU', pct: 3.5 }, { name: 'Stripe', pct: 2.9 }],
    plataformas: [{ name: 'MercadoLibre', pct: 4 }, { name: 'Tienda Nube', pct: 3 }, { name: 'Shopify', pct: 2 }],
    cuotas: { 2: [11, 7, 9], 3: [15, 12, 16], 6: [30, 27, 32], 12: [70, 60, 68] }, mv: 30, mm: 15, desc: 0 };
}
export type Sel = { pack: boolean; envio: boolean; com: boolean; iibb: boolean; ret: boolean; pas: number; plat: number; desc: number };
export const selDefault: Sel = { pack: false, envio: false, com: false, iibb: true, ret: true, pas: 0, plat: 0, desc: 0 };

export function redondear(p: number, c: Cfg) {
  const m = Math.max(c.redMult, 1);
  if (c.redTipo === 'Múltiplo') return Math.ceil(p / m) * m;
  if (c.redTipo.startsWith('Psicol')) return p < 1000 ? Math.ceil(p / m) * m : Math.ceil((p + m) / 1000) * 1000 - m;
  return Math.round(p * 100) / 100;
}

// Margen sobre el PRECIO FINAL: precio = (costo + fijos) / (1 − margen% − % que se lleva el precio)
export function calcPrecio(costo: number, margen: number, c: Cfg, sel: Sel, cuotas = 1, pas = sel.pas) {
  const fijos: [string, number][] = [];
  if (sel.pack) fijos.push(['Packaging', c.packaging]);
  if (sel.envio) fijos.push(['Envío', c.envio]);
  const pa = pas ? c.pasarelas[pas - 1] : null, pl = sel.plat ? c.plataformas[sel.plat - 1] : null;
  const pcts: [string, number][] = [
    ['Comisión vendedor', sel.com ? c.comision : 0], ['Ingresos Brutos', sel.iibb ? c.iibb : 0], ['Retenciones', sel.ret ? c.retenciones : 0],
    [pa ? `Pasarela (${pa.name})` : 'Pasarela', pa ? pa.pct : 0], ['Recargo por cuotas', pa && cuotas > 1 ? c.cuotas[cuotas][pas - 1] : 0],
    [pl ? `Plataforma (${pl.name})` : 'Plataforma', pl ? pl.pct : 0]];
  const den = 1 - (margen + pcts.reduce((a, [, x]) => a + x, 0)) / 100;
  if (den <= 0.01) return null;
  const base = costo + fijos.reduce((a, [, x]) => a + x, 0), d = Math.min(sel.desc || 0, 99);
  const lista = redondear(base / den / (1 - d / 100), c), final = lista * (1 - d / 100);
  const ded = pcts.filter(([, x]) => x).map(([n, x]) => [n, final * x / 100, x] as [string, number, number]);
  const ganancia = final - base - ded.reduce((a, [, v]) => a + v, 0);
  return { costo, fijos, base, lista, final, d, descMonto: lista - final, ded, ganancia, real: final ? ganancia / final * 100 : 0 };
}
