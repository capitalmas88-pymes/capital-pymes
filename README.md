# 🏢 Capital+ PyMEs — Gestión para pequeñas y medianas empresas

Aplicación web hecha con **Streamlit** y **Supabase** para que una PyME ordene su negocio y decida con números: registrá ventas, compras y gastos en segundos y mirá al instante tu stock, tu caja y tu resultado del mes.

## ✨ Funcionalidades

- ⚡ **Registradora exprés**: ventas, compras, gastos, cobros y pagos.
- 📦 **Inventario** con alertas de stock crítico.
- 🧮 **Calculadora de costos (escandallo)** y precio sugerido.
- 📊 **Estado de resultados** y **flujo de caja** en tiempo real.
- 📎 **Importación** de compras y gastos desde CSV, Excel o PDF.
- 🔐 Login, registro y recuperación de contraseña (Supabase Auth).
- 💳 Paywall / suscripción por módulo (configurable).

## 🗂️ Estructura del proyecto

```
.
├── app_pyme.py             # Archivo principal (entrada de la app)
├── modulo_pyme.py          # Lógica y pantallas del módulo PyME
├── modulo_pago_manual.py   # Paywall / suscripción
├── modulo_landing.py       # Recuperación de contraseña y búsqueda de usuarios
├── requirements.txt        # Dependencias
├── .gitignore
└── .streamlit/
    └── secrets.toml        # ⚠️ NO se sube a GitHub (claves privadas)
```

## 🚀 Instalación local

1. Cloná el repositorio:
   ```bash
   git clone https://github.com/TU_USUARIO/TU_REPO.git
   cd TU_REPO
   ```
2. (Opcional) Creá un entorno virtual:
   ```bash
   python -m venv venv
   source venv/bin/activate      # En Windows: venv\Scripts\activate
   ```
3. Instalá las dependencias:
   ```bash
   pip install -r requirements.txt
   ```
4. Creá el archivo `.streamlit/secrets.toml` con tus claves de Supabase:
   ```toml
   SUPABASE_URL = "https://xxxxxxxx.supabase.co"
   SUPABASE_KEY = "tu_anon_key"
   SUPABASE_SERVICE_KEY = "tu_service_role_key"
   ```
5. Ejecutá la app:
   ```bash
   streamlit run app_pyme.py
   ```

## ⚙️ Configuración

En `app_pyme.py`:

| Variable | Descripción |
|---|---|
| `MODULO_ID` | Clave del módulo en `PRODUCTOS` de `modulo_pago_manual.py` (por defecto `'pyme'`). |
| `REQUIERE_SUSCRIPCION` | `True` exige trial/plan activo; `False` da acceso libre (útil para pruebas). |

## ☁️ Deploy en Streamlit Community Cloud

1. Subí el proyecto a GitHub.
2. Entrá a [share.streamlit.io](https://share.streamlit.io) e iniciá sesión con GitHub.
3. Elegí **New app**, seleccioná el repo y la rama, y como **Main file path** poné `app_pyme.py`.
4. En **Advanced settings → Secrets** pegá el contenido de tu `secrets.toml`.
5. Hacé click en **Deploy**.

## 🔒 Seguridad

- **Nunca** subas `secrets.toml` ni la `SUPABASE_SERVICE_KEY` a GitHub. La service key da acceso total a tu base de datos.
- Si alguna vez subiste una clave por error, regenerala desde el panel de Supabase.

## 🛠️ Tecnologías

- [Streamlit](https://streamlit.io) — interfaz web
- [Supabase](https://supabase.com) — base de datos y autenticación
- [streamlit-cookies-controller](https://pypi.org/project/streamlit-cookies-controller/) — persistencia de sesión

## ⚠️ Aviso

Herramienta de gestión con fines informativos.
