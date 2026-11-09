import { NextResponse } from 'next/server';
import { crearClienteServidor } from '../../../lib/supabase/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');

  if (code) {
    const { error } = await crearClienteServidor().auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL('/?auth_error=1', url.origin));
    }
  }
  return NextResponse.redirect(new URL('/', url.origin));
}
