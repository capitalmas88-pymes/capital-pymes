import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Cliente para route handlers / server components (Next 14)
export function crearClienteServidor() {
  const store = cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: list => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch { /* server component: lo refresca el middleware */ } },
    },
  });
}
