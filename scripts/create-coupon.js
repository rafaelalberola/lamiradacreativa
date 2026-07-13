// Crea (idempotente) el cupón de bienvenida 5% + código promocional BIENVENIDA5 en Stripe.
// Uso:  STRIPE_SECRET_KEY=sk_live_... node scripts/create-coupon.js
// La key NO se imprime; solo se muestran los IDs resultantes.

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('Falta STRIPE_SECRET_KEY en el entorno.');
  process.exit(1);
}
const stripe = require('stripe')(key);

const PROMO_CODE = 'BIENVENIDA5';

(async () => {
  try {
    // ¿Ya existe el código promocional?
    const existing = await stripe.promotionCodes.list({ code: PROMO_CODE, limit: 1 });
    if (existing.data.length) {
      const p = existing.data[0];
      console.log('YA EXISTE →', 'promo:', p.id, '| coupon:', p.coupon.id, '| percent_off:', p.coupon.percent_off + '%', '| active:', p.active);
      return;
    }

    // Crear cupón 5%
    const coupon = await stripe.coupons.create({
      percent_off: 5,
      duration: 'once',
      name: 'Bienvenida 5%',
    });

    // Crear código promocional legible
    const promo = await stripe.promotionCodes.create({
      coupon: coupon.id,
      code: PROMO_CODE,
    });

    console.log('CREADO ✓');
    console.log('  coupon:', coupon.id, '(', coupon.percent_off + '% off )');
    console.log('  promo :', promo.id, '→ código:', promo.code, '| active:', promo.active);
  } catch (err) {
    console.error('Error creando el cupón:', err.message);
    process.exit(1);
  }
})();
