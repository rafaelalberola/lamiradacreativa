# Backoffice de métricas — setup

Dashboard propio en `/metrics/` (login Auth0, solo admin) + resumen diario a Telegram.
Sin Amplitude: los datos salen de **Stripe** (ingresos/CVR), **Meta** (gasto/ROAS),
**Supabase** (leads/cohortes/engagement), **Resend** (audiencia) y **analítica propia**.

Piezas nuevas:
- `metrics/index.html` — dashboard (tiles, embudo, gráficas, cohortes, ajustes).
- `netlify/functions/metrics-api.js` — API protegida (Auth0 + allowlist).
- `netlify/functions/daily-telegram.js` — cron diario → Telegram.
- `netlify/functions/track.js` + `js/analytics.js` — beacon de visitas first-party.
- `netlify/lib/metrics.js` — motor de métricas y de acciones (compartido).
- `netlify/lib/auth0-verify.js` — verificación de firma RS256 + allowlist admin.
- `netlify/functions/sql/metrics.sql` — tablas `metrics_config` y `events`.

---

## 1) Base de datos (una vez)

Supabase → SQL editor → pega y ejecuta `netlify/functions/sql/metrics.sql`.
Crea `metrics_config` (fila única con caja/costes/targets) y `events` (visitas).

## 2) Variables de entorno (Netlify → Site settings → Environment)

| Variable | Para qué | Obligatoria |
|---|---|---|
| `ADMIN_EMAILS` | Emails con acceso al dashboard (coma-separados). Ej: `helloimrafa@gmail.com` | Sí |
| `AUTH0_CLIENT_ID` | Client id del SPA (aud del token). `wTRFr8TqbqdxBkWCJeQ052zvGGemnwsZ` | Recom. |
| `STRIPE_SECRET_KEY` | Ingresos/CVR (ya existe en Netlify) | Sí |
| `META_ACCESS_TOKEN` | Gasto/ROAS. **Usa un token de Usuario del Sistema** (ver §5) | Sí |
| `META_AD_ACCOUNT_ID` | Cuenta de ads. Por defecto `act_1405709477618981` | No |
| `TELEGRAM_BOT_TOKEN` | Envío a Telegram (ver §4) | Sí (Telegram) |
| `TELEGRAM_CHAT_ID` | Tu chat id | Sí (Telegram) |
| `TELEGRAM_TEST_KEY` | Clave para probar el envío por HTTP (opcional) | No |
| `RESEND_FULL_KEY` | Leer tamaño de la audiencia Resend (la key normal es solo-envío) | No |

`AUTH0_DOMAIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_AUDIENCE_ID` ya están.

## 3) Auth0 (login del dashboard)

En Auth0 → Applications → tu SPA (client `wTRFr8...`) → Settings, añade la URL del backoffice:
- **Allowed Callback URLs**: `https://lamiradacreativa.com/metrics/`, `http://localhost:8888/metrics/`
- **Allowed Logout URLs**: `https://lamiradacreativa.com/metrics/`
- **Allowed Web Origins**: `https://lamiradacreativa.com`

El login usa magic link por email (`connection: 'email'`), igual que la app.
Si tu email no estuviera dado de alta: en Authentication → Passwordless → Email, asegúrate
de que la conexión permite sign-ups, o crea el usuario una vez. El acceso lo cierra
`ADMIN_EMAILS` (aunque alguien se loguee, si no está en la lista, recibe 401).

## 4) Telegram (aviso diario)

1. En Telegram, habla con **@BotFather** → `/newbot` → nombre y usuario → te da el **token** → `TELEGRAM_BOT_TOKEN`.
2. Abre un chat con tu bot y escríbele algo (ej. `hola`).
3. Consigue tu `chat_id`: abre en el navegador
   `https://api.telegram.org/bot<TOKEN>/getUpdates` y copia `message.chat.id` → `TELEGRAM_CHAT_ID`.
4. Prueba el envío (si pusiste `TELEGRAM_TEST_KEY`):
   `https://lamiradacreativa.com/.netlify/functions/daily-telegram?key=<TELEGRAM_TEST_KEY>`
5. El cron ya está en `netlify.toml`: **08:00 CET / 09:00 CEST** (`0 6 * * *`).

## 5) Token de Meta que NO caduca (Usuario del Sistema)

Los tokens personales caducan (horas / ~60 días). La solución permanente:

1. `business.facebook.com` → **Configuración del negocio**.
2. **Usuarios → Usuarios del sistema** → *Agregar* → nombre `metrics-bot`, rol **Admin**.
3. **Asignar activos → Cuentas publicitarias** → tu cuenta `act_1405709477618981` → permiso de lectura ("ver rendimiento").
4. **Generar nuevo token** → elige tu App de Meta → **Caducidad: "Nunca"** → permisos `ads_read` y `read_insights`.
5. Copia el token → guárdalo como `META_ACCESS_TOKEN`. No caduca; revocable cuando quieras.

Necesitas una App de Meta (developers.facebook.com) dentro del mismo negocio. Para leer tu
propia cuenta con `ads_read` no hace falta App Review. (El "exchange a 60 días" es un parche;
el System User es lo definitivo.)

## 6) Configura runway

Entra en `/metrics/` → sección **Ajustes** → mete **caja disponible** y **costes fijos
mensuales** (y, si tienes publi fuera de Meta, el gasto de los últimos 30 días). Guarda.
El runway y el beneficio se recalculan al instante. También ajustas ahí tus objetivos
(ROAS, CPL, CAC, umbral de aviso de runway), que alimentan el motor de acciones.

## 7) Notas

- **Analítica propia**: empieza a contar visitas desde el despliegue. El histórico del
  embudo por encima del checkout se irá llenando desde hoy.
- Todos los secretos se quedan en el servidor. `/metrics/` no lleva claves ni datos: si
  alguien la abre, ve un login, y la API no devuelve nada sin token de admin válido.
- Si el dashboard tarda mucho a futuro (muchas sesiones de Stripe), se puede cachear el
  bundle unos minutos. Con el volumen actual no hace falta.
