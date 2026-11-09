'use client';
import { useMemo, useState } from 'react';
import { crearCliente } from '../../lib/supabase/client';

export default function Login() {
  const sb = useMemo(() => crearCliente(), []);
  const [modo, setModo] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null); const [ocupado, setOcupado] = useState(false);

  const enviar = async () => {
    setOcupado(true); setMsg(null);
    try {
      const volver = `${location.origin}/auth/callback`;
      if (modo === 'in') {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error; location.href = '/';
      } else if (modo === 'up') {
        if (pass.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: volver } });
        if (error) throw error;
        if (data.session) location.href = '/';
        else setMsg({ ok: true, t: 'Te mandamos un mail para confirmar tu cuenta. Después de confirmarlo ya podés ingresar.' });
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: volver });
        if (error) throw error;
        setMsg({ ok: true, t: 'Si el mail existe, te enviamos un link para recuperar el acceso.' });
      }
    } catch (e: any) {
      const t = String(e?.message ?? e);
      setMsg({ ok: false, t: /invalid login/i.test(t) ? 'Mail o contraseña incorrectos.' : /already registered/i.test(t) ? 'Ese mail ya tiene cuenta: ingresá.' : t });
    } finally { setOcupado(false); }
  };

  return (<div className="wrap" style={{ maxWidth: 420, margin: '60px auto' }}>
    <div className="box">
      <div className="brand" style={{ marginBottom: 12 }}>🏢 Capital<b>+</b> PyMEs</div>
      <h3>{modo === 'in' ? 'Ingresar' : modo === 'up' ? 'Crear cuenta' : 'Recuperar acceso'}</h3>
      <div className="form">
        <label>Mail<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>
        {modo !== 'reset' && <label>Contraseña<input type="password" value={pass} onChange={e => setPass(e.target.value)}
          autoComplete={modo === 'in' ? 'current-password' : 'new-password'} onKeyDown={e => { if (e.key === 'Enter' && email && pass) enviar(); }} /></label>}
      </div>
      <button className="p" disabled={ocupado || !email || (modo !== 'reset' && !pass)} onClick={enviar}>
        {modo === 'in' ? 'Ingresar' : modo === 'up' ? 'Crear cuenta' : 'Enviar link'}</button>
      {msg && <p className={msg.ok ? 'pos' : 'neg'}>{msg.t}</p>}
      <div className="pills">
        {modo !== 'in' && <button onClick={() => { setModo('in'); setMsg(null); }}>Ya tengo cuenta</button>}
        {modo !== 'up' && <button onClick={() => { setModo('up'); setMsg(null); }}>Crear cuenta</button>}
        {modo === 'in' && <button onClick={() => { setModo('reset'); setMsg(null); }}>Olvidé mi contraseña</button>}
      </div>
    </div></div>);
}
