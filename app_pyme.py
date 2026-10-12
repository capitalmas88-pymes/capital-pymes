# ==============================================================
#  APP PyMEs — entrada independiente (deploy dedicado a PyMEs)
#
#  Archivos que necesita en el mismo repo:
#     app_pyme.py            (este archivo — es el "Main file" del deploy)
#     modulo_pyme.py         (tu módulo, sin cambios)
#     modulo_pago_manual.py  (paywall / suscripción — el que ya tenés)
#     modulo_landing.py      (solo se reutiliza buscar_uid_por_email y la
#                             recuperación de contraseña)
#
#  Secrets (.streamlit/secrets.toml):
#     SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY
# ==============================================================

import warnings
warnings.filterwarnings("ignore")

from datetime import datetime
from zoneinfo import ZoneInfo

import streamlit as st
import altair as alt   # ya viene incluido con Streamlit
from supabase import create_client
from streamlit_cookies_controller import CookieController

from modulo_pyme import render_pyme, render_nav_pyme, get_nombre_negocio
from modulo_landing import _render_recuperar_contrasena
from modulo_pago_manual import pantalla_suscripcion_modulo, es_admin_usuario

# ──────────────────────────────────────────────────────────────
#  CONFIG
# ──────────────────────────────────────────────────────────────
MODULO_ID = 'pyme'              # clave en PRODUCTOS de modulo_pago_manual
REQUIERE_SUSCRIPCION = True     # False = acceso libre mientras lo probás
MODO_DEMO = True                # True = sin login ni Supabase (solo para probar)
ZONA_AR = ZoneInfo("America/Argentina/Buenos_Aires")

st.set_page_config(
    page_title="Gestión PyME",
    page_icon="🏢",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ──────────────────────────────────────────────────────────────
#  CSS — mismo look que la app de Mercados (solo lo que usa PyMEs)
# ──────────────────────────────────────────────────────────────
st.markdown("""
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
  :root {
    --verde-monster: #6CC24A;
    --verde-monster-hover: #8ddb5e;
    --verde-monster-dim: #4f9438;
  }
  [data-testid="stSidebar"], [data-testid="collapsedControl"] { display: none !important; }

  html, body, [class*="css"] { font-family: 'Inter', sans-serif; background:#07090f; color:#fff; font-size:14px; }
  .stApp { background:#07090f; }
  .block-container { padding: 20px 2rem 2rem 2rem !important; max-width: 1400px; }

  /* Botones ovalados, texto verde */
  .stButton > button, .stFormSubmitButton > button {
    background:#0d1117 !important; color:var(--verde-monster) !important;
    border:1px solid #21262d !important; border-radius:999px !important;
    padding:6px 18px !important; font-weight:600 !important; font-size:12.5px !important;
    transition:all .18s ease !important; box-shadow:none !important;
  }
  .stButton > button:hover, .stFormSubmitButton > button:hover {
    border-color:var(--verde-monster) !important; color:var(--verde-monster-hover) !important;
    background:#11150f !important; transform:translateY(-1px) !important;
  }
  .stButton > button:disabled, .stFormSubmitButton > button:disabled {
    opacity:.35 !important; transform:none !important;
  }

  /* Popover de cuenta */
  .st-key-nav_cuenta_cont button {
    border-radius:999px !important; border:1px solid #21262d !important;
    background:#0d1117 !important; color:var(--verde-monster) !important;
    font-weight:600 !important; font-size:12.5px !important; width:100% !important;
  }

  /* KPI cards y títulos (los usa modulo_pyme) */
  .kpi-card { background:#0d1117; border:1px solid #21262d; border-radius:10px;
    padding:16px 18px; position:relative; overflow:hidden; transition:border-color .2s; }
  .kpi-card:hover { border-color:#3a7bd5; }
  .kpi-accent { position:absolute; top:0; left:0; width:100%; height:2px; }
  .kpi-label { color:#f5f7fa; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px; }
  .kpi-value { color:#e6edf3; font-size:22px; font-weight:700; letter-spacing:-.5px; font-family:'JetBrains Mono',monospace; }
  .kpi-sub { color:#f5f7fa; font-size:13px; margin-top:4px; }
  .sec-title { font-size:14px; font-weight:700; color:#e6edf3; text-transform:uppercase;
    letter-spacing:.8px; margin:6px 0 12px 0; padding-bottom:8px; border-bottom:1px solid #21262d; text-align:center; }

  /* Inputs / tablas */
  .stSelectbox > div > div { background:#0d1117 !important; border-color:#21262d !important; color:#e6edf3 !important; }
  [data-testid="stMetric"] { background:#0d1117; border:1px solid #21262d; border-radius:9px; padding:12px 16px; }
  .stDataFrame { border-radius:10px; overflow:hidden; }
  hr { border-color:#21262d !important; }
  p, label, .stMarkdown { color:#f5f7fa !important; font-size:14px !important; }

  /* Barra superior */
  .pyme-topbar { display:flex; align-items:center; justify-content:space-between;
    padding:6px 4px 14px 4px; border-bottom:1px solid #21262d; margin-bottom:14px; }
  .pyme-brand { display:flex; align-items:center; gap:10px; }
  .pyme-brand-icon { width:30px; height:30px; border-radius:8px;
    background:linear-gradient(135deg,#1e4fa8,#3a7bd5); display:flex; align-items:center; justify-content:center; font-size:14px; }
  .pyme-brand-name { font-size:16px; font-weight:800; color:#e6edf3; letter-spacing:-.3px; }
  .pyme-brand-name span { color:#6CC24A; }
  .pyme-time { font-size:12px; color:#f5f7fa; font-family:'JetBrains Mono',monospace; }

  /* Mobile: la nav de 4 botones scrollea en horizontal en vez de apilarse */
  @media (max-width: 768px) {
    .st-key-nav_pills_wrap div[data-testid="stHorizontalBlock"] {
      display:flex !important; flex-wrap:nowrap !important; overflow-x:auto !important; gap:6px !important;
    }
    .st-key-nav_pills_wrap div[data-testid="column"] { flex:0 0 auto !important; width:auto !important; min-width:150px !important; }
    .st-key-nav_pills_wrap .stButton > button { white-space:nowrap !important; }
    .block-container { padding: 12px 0.8rem 2rem 0.8rem !important; }
  }
</style>
""", unsafe_allow_html=True)

# ──────────────────────────────────────────────────────────────
#  SUPABASE + SESIÓN
# ──────────────────────────────────────────────────────────────
@st.cache_resource
def init_supabase():
    return create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_KEY"])

@st.cache_resource
def init_supabase_admin():
    return create_client(st.secrets["SUPABASE_URL"], st.secrets["SUPABASE_SERVICE_KEY"])

if MODO_DEMO:
    auth_client = supabase = None
else:
    auth_client = init_supabase()
    supabase = init_supabase_admin()

cookies = CookieController()


def restaurar_sesion():
    """Si session_state perdió el login, lo recupera desde la cookie del navegador."""
    if "usuario" in st.session_state:
        return
    refresh_token = cookies.get("sb_refresh_token")
    if refresh_token:
        try:
            res = auth_client.auth.refresh_session(refresh_token)
            st.session_state["usuario"] = res.user
            cookies.set("sb_refresh_token", res.session.refresh_token)
        except Exception:
            cookies.remove("sb_refresh_token")


def cerrar_sesion():
    try:
        auth_client.auth.sign_out()
    except Exception:
        pass
    cookies.remove("sb_refresh_token")
    st.session_state.pop("usuario", None)
    st.rerun()


# ──────────────────────────────────────────────────────────────
#  PANTALLA DE ACCESO (login / registro / recuperar contraseña)
# ──────────────────────────────────────────────────────────────
def pantalla_acceso():
    st.markdown("""
    <style>
      .acc-title { font-size:32px; font-weight:800; color:#e6edf3; letter-spacing:-1px; line-height:1.18; margin-bottom:12px; }
      .acc-title span { color:#6CC24A; }
      .acc-sub { font-size:14.5px; color:#8b949e; line-height:1.7; }
      .acc-feat { font-size:13px; color:#c9d1d9; padding:5px 0; }
    </style>
    """, unsafe_allow_html=True)

    _, col_hero, col_auth, _ = st.columns([0.3, 1.2, 1, 0.3], gap="large")

    with col_hero:
        st.markdown("""
        <div style="margin-top:40px">
          <div style="display:inline-block;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;
               letter-spacing:.8px;text-transform:uppercase;background:rgba(108,194,74,0.12);
               border:1px solid #6CC24A;color:#6CC24A;margin-bottom:18px">🏢 Gestión para PyMEs</div>
          <div class="acc-title">Ordená tu negocio,<br>decidí con <span>números</span></div>
          <div class="acc-sub">Registrá ventas, compras y gastos en segundos, y mirá al instante tu stock,
          tu caja y tu resultado del mes.</div>
          <div style="margin-top:18px">
            <div class="acc-feat">⚡ Registradora exprés (ventas, compras, gastos, cobros y pagos)</div>
            <div class="acc-feat">📦 Inventario con alertas de stock crítico</div>
            <div class="acc-feat">🧮 Calculadora de costos (escandallo) y precio sugerido</div>
            <div class="acc-feat">📊 Estado de resultados y flujo de caja en tiempo real</div>
            <div class="acc-feat">📎 Importación de compras y gastos desde CSV, Excel o PDF</div>
          </div>
        </div>
        """, unsafe_allow_html=True)

    with col_auth:
        st.markdown('<div style="height:30px"></div>', unsafe_allow_html=True)
        with st.container(border=True):
            tab_login, tab_reg = st.tabs(["Iniciar sesión", "Crear cuenta"])

            with tab_login:
                email = st.text_input("Email", key="acc_login_email")
                password = st.text_input("Contraseña", type="password", key="acc_login_pass")
                if st.button("Entrar", use_container_width=True, key="acc_btn_login", type="primary"):
                    if not email or not password:
                        st.error("Completá email y contraseña.")
                    else:
                        try:
                            res = auth_client.auth.sign_in_with_password({"email": email, "password": password})
                            st.session_state["usuario"] = res.user
                            cookies.set("sb_refresh_token", res.session.refresh_token)
                            st.rerun()
                        except Exception:
                            st.error("Email o contraseña incorrectos.")
                with st.expander("¿Olvidaste tu contraseña?"):
                    _render_recuperar_contrasena(supabase)

            with tab_reg:
                email_r = st.text_input("Email", key="acc_reg_email")
                pass_r = st.text_input("Contraseña", type="password", key="acc_reg_pass")
                pass_r2 = st.text_input("Confirmar contraseña", type="password", key="acc_reg_pass2")
                if st.button("Crear cuenta", use_container_width=True, key="acc_btn_reg", type="primary"):
                    if not email_r or not pass_r:
                        st.error("Completá email y contraseña.")
                    elif pass_r != pass_r2:
                        st.error("Las contraseñas no coinciden.")
                    elif len(pass_r) < 6:
                        st.error("La contraseña debe tener al menos 6 caracteres.")
                    else:
                        try:
                            res_reg = auth_client.auth.sign_up({
                                "email": email_r, "password": pass_r,
                                "options": {"data": {"servicio_elegido": MODULO_ID}},
                            })
                            user_nuevo = getattr(res_reg, "user", None)
                            if user_nuevo is not None:
                                try:
                                    (supabase.table("perfiles")
                                     .update({"servicio_elegido": MODULO_ID})
                                     .eq("id", user_nuevo.id).execute())
                                except Exception:
                                    pass
                            st.success("¡Cuenta creada! Revisá tu email para confirmarla y después iniciá sesión.")
                        except Exception as e:
                            st.error(f"Error al registrarse: {e}")

    st.markdown(
        "<div style='text-align:center;color:#3a4a5a;font-size:11px;padding:40px 0 10px 0'>"
        "Herramienta de gestión con fines informativos.</div>",
        unsafe_allow_html=True,
    )


# ──────────────────────────────────────────────────────────────
#  FLUJO PRINCIPAL
# ──────────────────────────────────────────────────────────────
if MODO_DEMO:
    USER_ID, EMAIL = "demo", "demo@capitalmas.com"
else:
    restaurar_sesion()
    if "usuario" not in st.session_state:
        pantalla_acceso()
        st.stop()
    USUARIO = st.session_state["usuario"]
    USER_ID = USUARIO.id
    EMAIL = USUARIO.email

# ── Paywall (admin y usuarios con trial/plan activo pasan) ──
if REQUIERE_SUSCRIPCION and not MODO_DEMO:
    if not pantalla_suscripcion_modulo(supabase, USER_ID, EMAIL, MODULO_ID):
        c1, c2, c3 = st.columns([3, 1, 3])
        with c2:
            if st.button("🚪 Cerrar sesión", key="paywall_logout", use_container_width=True):
                cerrar_sesion()
        st.stop()

# ── Barra superior: marca + hora ──
nombre_neg = get_nombre_negocio() or "Gestión PyME"
ahora = datetime.now(ZONA_AR).strftime('%H:%M')
st.markdown(f"""
<div class="pyme-topbar">
  <div class="pyme-brand">
    <div class="pyme-brand-icon">🏢</div>
    <div class="pyme-brand-name">Capital<span>+</span> PyMEs</div>
  </div>
  <div class="pyme-time">🕐 {ahora}</div>
</div>
""", unsafe_allow_html=True)

# ── Navegación: 4 módulos + cuenta ──
with st.container(key='nav_pills_wrap'):
    cols = st.columns([1.4, 1.4, 1.4, 1.4, 0.2, 1.3])
    render_nav_pyme([cols[0], cols[1], cols[2], cols[3]])
    with cols[5]:
        with st.container(key='nav_cuenta_cont'):
            with st.popover("👤 Mi Cuenta", use_container_width=True):
                st.markdown(
                    f'<div style="font-size:11px;color:#6b7d9a;padding:2px 4px 8px 4px">{EMAIL}</div>',
                    unsafe_allow_html=True,
                )
                if st.button("🚪 Cerrar sesión", use_container_width=True, key="btn_logout"):
                    cerrar_sesion()

st.markdown('<div style="height:6px"></div>', unsafe_allow_html=True)

# ── Módulo ──
render_pyme(supabase, USER_ID)
