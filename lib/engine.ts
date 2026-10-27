export type Tipo = 'SALE' | 'PURCHASE' | 'EXPENSE' | 'COLLECTION' | 'PAYMENT';
export type St = 'PAID' | 'PENDING';
export type Prod = { id: number; name: string; stock: number; min: number; cost: number; price: number };
export type Medio = { name: string; tipo: 'caja' | 'banco' | 'credito' };
export type Item = { pid: number; name: string; qty: number; price: number; cost: number };
export type Tx = { id: number; type: Tipo; desc: string; amount: number; costAmt: number; medio: string; status: St;
  due?: string; at: string; items: Item[]; void: boolean; paidBy?: number; pays?: number; disc: number };
export type S = { prods: Prod[]; txs: Tx[]; medios: Medio[]; caja0: number; banco0: number; seq: number };

export const money = (v: number) => (v < 0 ? '-' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('es-AR');
const now = () => new Date().toISOString();
export const medioTipo = (s: S, n: string) => s.medios.find(m => m.name === n)?.tipo ?? 'banco';
const prod = (s: S, id: number) => s.prods.find(p => p.id === id);
function push(s: S, t: Omit<Tx, 'id' | 'void'>, due?: string) {
  if (medioTipo(s, t.medio) === 'credito' && t.type !== 'COLLECTION' && t.type !== 'PAYMENT') t.status = 'PENDING';
  const x: Tx = { ...t, id: ++s.seq, void: false, due: t.status === 'PENDING' ? due : undefined };
  s.txs.push(x); return x;
}

export function venta(s: S, cart: Record<number, number>, medio: string, st: St, due: string | undefined,
  nota = '', pct = 0, at = now()): string | null {
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
  push(s, { type: 'SALE', desc: items.map(i => `${i.qty}× ${i.name}`).join(', ') + (disc ? ` (desc. ${pct}%)` : '') + (nota ? ` — ${nota}` : ''),
    amount: bruto - disc, costAmt: costo, medio, status: st, at, items, disc }, due);
  return null;
}

export function compra(s: S, pid: number, qty: number, cost: number, medio: string, st: St, due?: string, at = now()): string | null {
  const p = prod(s, pid);
  if (!p) return 'Producto inexistente.';
  if (qty <= 0 || cost < 0) return 'Cantidad y costo deben ser válidos.';
  const tot = p.stock + qty;
  p.cost = Math.round(((p.stock * p.cost + qty * cost) / tot) * 100) / 100; // costo promedio ponderado
  p.stock = tot;
  push(s, { type: 'PURCHASE', desc: `${qty}× ${p.name} (compra)`, amount: qty * cost, costAmt: 0, medio, status: st, at,
    items: [{ pid, name: p.name, qty, price: 0, cost }], disc: 0 }, due);
  return null;
}

export function gasto(s: S, cat: string, desc: string, monto: number, medio: string, st: St, due?: string, at = now()): string | null {
  if (monto <= 0) return 'El monto debe ser mayor a 0.';
  push(s, { type: 'EXPENSE', desc: desc ? `${cat}: ${desc}` : cat, amount: monto, costAmt: 0, medio, status: st, at, items: [], disc: 0 }, due);
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
    if (t.type === 'SALE') { v += t.amount + t.disc; d += t.disc; c += t.costAmt; }
    else if (t.type === 'EXPENSE') g += t.amount;
  }
  return { v, d, c, g, vn: v - d, bruta: v - d - c, neta: v - d - c - g };
}

export const por = (s: S, tipos: Tipo[]) => s.txs.filter(t => !t.void && t.status === 'PENDING' && tipos.includes(t.type));

export function seed(): S {
  const s: S = { seq: 0, caja0: 60000, banco0: 600000, txs: [],
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
  gasto(s, 'Alquiler', 'Alquiler del local', 350000, 'Transferencia Bancaria', 'PAID', undefined, ago(48));
  compra(s, 4, 24, 700, 'Fiado / Cta Corriente', 'PENDING', day(10), ago(24));
  venta(s, { 2: 5, 3: 5 }, 'Fiado / Cta Corriente', 'PENDING', day(-1), 'Oficina García', 0, ago(72));
  venta(s, { 3: 2, 1: 4 }, 'Efectivo', 'PAID', undefined, '', 0, ago(26));
  venta(s, { 3: 1, 1: 2 }, 'Efectivo', 'PAID', undefined, '', 0, ago(5));
  venta(s, { 2: 2, 6: 2 }, 'Mercado Pago', 'PAID', undefined, '', 0, ago(4));
  venta(s, { 5: 3, 4: 3 }, 'Efectivo', 'PAID', undefined, '', 0, ago(3));
  venta(s, { 3: 4, 1: 6 }, 'Fiado / Cta Corriente', 'PENDING', day(7), 'Estudio Pérez', 0, ago(2));
  gasto(s, 'Servicios', 'Luz y gas', 18500, 'Efectivo', 'PAID', undefined, ago(1));
  return s;
}
