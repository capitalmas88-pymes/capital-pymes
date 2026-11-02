// Guardar como app/api/ia/route.ts
// Variables de entorno (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY=sk-ant-...        (NUNCA con prefijo NEXT_PUBLIC_)
//   IA_MODEL=claude-sonnet-5-5          (opcional; para copy/SEO masivo podés usar claude-haiku-5-5, más barato)
import { NextRequest, NextResponse } from 'next/server';
import { SYS_CHAT, SYS_COPY, SYS_REACT, SYS_SEO, limpiarSeo } from '../../../lib/ia';

export const runtime = 'nodejs';
const MODEL = process.env.IA_MODEL || 'claude-sonnet-5-5';

// Rate limit en memoria (por instancia). En producción: Upstash/Redis o la tabla de Supabase.
const hits = new Map<string, number[]>();
const limitado = (ip: string, max = 20, ventanaMs = 60_000) => {
  const now = Date.now(), arr = (hits.get(ip) ?? []).filter(t => now - t < ventanaMs);
  arr.push(now); hits.set(ip, arr); return arr.length > max;
};

async function claude(system: string, messages: { role: 'user' | 'assistant'; content: string }[], maxTokens: number, temperature: number) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, temperature, system, messages }) });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('').trim();
}

// El modelo a veces envuelve el JSON en ```; esto lo tolera
const parseJson = <T,>(txt: string): T => JSON.parse(txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim());

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'Falta ANTHROPIC_API_KEY en el servidor.' }, { status: 500 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  if (limitado(ip)) return NextResponse.json({ error: 'Demasiadas consultas seguidas. Esperá un minuto.' }, { status: 429 });
  // TODO auth: cuando haya login, validá la sesión/usuario acá y rechazá con 401.

  try {
    const { modo, negocio = '', payload } = await req.json();
    const neg = String(negocio).slice(0, 80);

    if (modo === 'chat') {
      const msgs = (payload.mensajes as { role: 'user' | 'assistant'; content: string }[]).slice(-10)
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 1500) }));
      if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return NextResponse.json({ error: 'Mensaje vacío.' }, { status: 400 });
      return NextResponse.json({ texto: await claude(SYS_CHAT(neg, payload.snapshot), msgs, 700, 0.2) });
    }
    if (modo === 'copy') {
      const { producto, canal = 'Instagram', tono = 'cercano' } = payload;
      const u = `Canal: ${canal}\nTono: ${tono}\nProducto (datos):\n${JSON.stringify(producto)}`;
      return NextResponse.json({ texto: await claude(SYS_COPY(neg), [{ role: 'user', content: u }], 500, 0.8) });
    }
    if (modo === 'seo') {
      const { producto, rubro = '', ciudad = '' } = payload;
      const u = `Rubro: ${rubro}\nCiudad/zona: ${ciudad}\nProducto (datos):\n${JSON.stringify(producto)}`;
      const o = parseJson<object>(await claude(SYS_SEO(neg), [{ role: 'user', content: u }], 400, 0.4));
      return NextResponse.json({ seo: limpiarSeo(o, producto.nombre) });
    }
    if (modo === 'reactivacion') {
      const { oferta = 10, tono = 'cálido' } = payload;
      const u = `Oferta de relanzamiento: ${oferta}%\nTono general: ${tono}\nCantidad de clientes inactivos: ${payload.cantidad ?? 'varios'}\nProductos estrella del local: ${(payload.productos ?? []).join(', ')}`;
      const arr = parseJson<string[]>(await claude(SYS_REACT(neg), [{ role: 'user', content: u }], 600, 0.9));
      const ok = arr.filter(x => typeof x === 'string' && x.includes('{nombre}'));
      return NextResponse.json({ variantes: ok.slice(0, 3) });
    }
    return NextResponse.json({ error: 'Modo inválido.' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error de IA.' }, { status: 502 });
  }
}
