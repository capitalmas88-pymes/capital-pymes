import { NextResponse } from 'next/server';
import { crearClienteServidor } from '../../../lib/supabase/server';

// Destino del link del mail de confirmación / recuperación
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (code) await crearClienteServidor().auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL('/', url.origin));
}
