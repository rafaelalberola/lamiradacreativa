// Branding del Checkout de Stripe (icon + logo).
//
// ⚠️ IMPORTANTE — leído la primera vez que esto "no funcionaba":
// La branding del PROPIO account NO se puede fijar por API. Stripe responde:
//   StripePermissionError: "You cannot use this method on your own account:
//   you may only use it on connected accounts."
// => El icon/logo del Checkout SOLO se cambian en el Dashboard:
//    https://dashboard.stripe.com/settings/branding
//    - "Icon" = el cuadrado que se ve en el Checkout (¡este es el que importa!)
//    - "Logo" = imagen ancha en otras páginas
//    Sube assets/images/stripe-icon.png (render de favicon.svg) en AMBOS.
//
// Este script NO intenta actualizar (fallaría): solo LEE la branding actual
// para que verifiques el cambio (el file id del icon debe cambiar tras subirlo).
//
// Uso:  STRIPE_SECRET_KEY=sk_live_... node scripts/update-stripe-branding.js

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('Falta STRIPE_SECRET_KEY en el entorno.'); process.exit(1); }
const stripe = require('stripe')(key);

(async () => {
  try {
    const acct = await stripe.accounts.retrieve();
    const b = (acct.settings && acct.settings.branding) || {};
    console.log('Account:', acct.id);
    console.log('Branding actual del Checkout:');
    console.log('  icon :', b.icon || '(sin icon)');
    console.log('  logo :', b.logo || '(sin logo)');
    console.log('  primary_color  :', b.primary_color);
    console.log('  secondary_color:', b.secondary_color);
    console.log('');
    console.log('Para cambiarlo: Dashboard → Settings → Branding →');
    console.log('  sube assets/images/stripe-icon.png en Icon Y Logo. Guarda.');
    console.log('  Vuelve a ejecutar este script: el file id del icon debe ser distinto.');
  } catch (err) {
    console.error('ERROR:', err.type || '', err.message);
    process.exit(1);
  }
})();
