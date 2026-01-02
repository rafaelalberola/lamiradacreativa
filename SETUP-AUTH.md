# Configuración del Sistema de Autenticación

## Resumen

- **Auth0**: Gestiona usuarios y autenticación
- **Stripe**: Procesa pagos
- **Netlify Function**: Conecta Stripe con Auth0 (crea usuarios al comprar)

---

## Parte 1: Auth0 - Aplicación SPA (Ya hecho ✅)

Tu aplicación SPA ya está configurada con:
- Domain: `dev-0m1u7zddedry8oo3.auth0.com`
- Client ID: `RD7Zj9wXQ4PnPnOubbCzdyM3qQb7RXrO`

---

## Parte 2: Auth0 - Aplicación Machine-to-Machine

Esta aplicación permite al webhook crear usuarios automáticamente.

### Paso 1: Crear la aplicación M2M

1. Ve a [Auth0 Dashboard](https://manage.auth0.com/dashboard/)
2. **Applications** → **Create Application**
3. Nombre: `Stripe Webhook`
4. Tipo: **Machine to Machine Applications**
5. Click **Create**

### Paso 2: Autorizar la API de Management

1. En la pantalla que aparece, selecciona **Auth0 Management API**
2. Marca estos permisos:
   - `read:users`
   - `create:users`
   - `update:users`
3. Click **Authorize**

### Paso 3: Obtener credenciales

En la pestaña **Settings** de la aplicación M2M, copia:
- **Client ID** (diferente al de la SPA)
- **Client Secret**

---

## Parte 3: Stripe Webhook

### Paso 1: Crear webhook en Stripe

1. Ve a [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Configura:
   - **URL**: `https://TU-DOMINIO.netlify.app/.netlify/functions/stripe-webhook`
   - **Events**: Selecciona `checkout.session.completed`
4. Click **Add endpoint**
5. Copia el **Signing secret** (empieza con `whsec_`)

### Paso 2: Actualizar Payment Links

Asegúrate de que tus Payment Links de Stripe:
- Recojan el **email** del cliente (obligatorio)
- Recojan el **nombre** (recomendado)

---

## Parte 4: Variables de Entorno en Netlify

1. Ve a **Netlify Dashboard** → Tu sitio → **Site settings**
2. **Environment variables** → **Add a variable**
3. Añade estas 4 variables:

| Variable | Valor |
|----------|-------|
| `STRIPE_WEBHOOK_SECRET` | `whsec_xxxxxxxxxx` |
| `AUTH0_DOMAIN` | `dev-0m1u7zddedry8oo3.auth0.com` |
| `AUTH0_M2M_CLIENT_ID` | El Client ID de la app M2M |
| `AUTH0_M2M_CLIENT_SECRET` | El Client Secret de la app M2M |

---

## Parte 5: Deploy

1. Haz commit de todos los cambios
2. Push a tu repositorio
3. Netlify desplegará automáticamente
4. Verifica la función en: **Functions** → `stripe-webhook`

---

## Flujo Completo

```
Cliente compra via Stripe Payment Link
         ↓
Stripe envía webhook a Netlify Function
         ↓
Function verifica firma de Stripe
         ↓
Function obtiene token de Auth0 Management API
         ↓
Function crea usuario en Auth0 (o actualiza si existe)
         ↓
Auth0 envía email de "Cambiar contraseña" al cliente
         ↓
Cliente establece su contraseña
         ↓
Cliente va a /app → Login → Acceso a las cartas
```

---

## Probar el Sistema

### Test local con Stripe CLI

```bash
# Instalar Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Escuchar webhooks y reenviar a local
stripe listen --forward-to localhost:8888/.netlify/functions/stripe-webhook

# En otra terminal, crear un pago de prueba
stripe trigger checkout.session.completed
```

### Test en producción

1. Haz una compra de prueba en Stripe (modo test)
2. Verifica en Auth0 Dashboard → **User Management** → **Users**
3. El usuario debería aparecer con `app_metadata.purchased: true`

---

## Troubleshooting

### El webhook no crea usuarios

1. Verifica los logs en Netlify → Functions → stripe-webhook
2. Comprueba que todas las variables de entorno estén configuradas
3. Verifica que los permisos de la app M2M incluyan `create:users`

### Error "Invalid signature"

- El `STRIPE_WEBHOOK_SECRET` no coincide
- Asegúrate de usar el secret del webhook específico, no la API key

### Error al obtener token de Auth0

- Verifica `AUTH0_M2M_CLIENT_ID` y `AUTH0_M2M_CLIENT_SECRET`
- Comprueba que la app M2M esté autorizada para Auth0 Management API

### Usuario creado pero no puede loguearse

- El usuario debe hacer click en el email de "Cambiar contraseña"
- O puede usar "Forgot password" en la pantalla de login de Auth0

---

## Costes

| Servicio | Gratis hasta |
|----------|--------------|
| Auth0 | 7,000 usuarios activos/mes |
| Netlify Functions | 125,000 requests/mes |
| Stripe Webhooks | Ilimitado |

---

## Archivos del Sistema

```
forma-landing/
├── app/
│   ├── index.html          # Login + Cartas (Auth0 SPA)
│   └── data.js             # Datos de las cartas
├── netlify/
│   └── functions/
│       └── stripe-webhook.js  # Crea usuarios en Auth0
├── netlify.toml            # Configuración Netlify
└── SETUP-AUTH.md           # Esta documentación
```
