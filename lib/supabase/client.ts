import { createBrowserClient } from '@supabase/ssr';

// Cliente para componentes 'use client' (navegador)
export const crearCliente = () =>
  createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
