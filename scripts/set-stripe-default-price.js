/**
 * Sets the default price on the Soccer Stats Pro Stripe product.
 * Run once: node scripts/set-stripe-default-price.js
 */
const Stripe = require('stripe');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const PRODUCT_ID = 'prod_UWtFiyWb2LoEy0';
const PRICE_ID = 'price_1TXpTJBbsFy1wAkF64nFdG26';

if (!STRIPE_SECRET_KEY) {
  console.error('❌  Set STRIPE_SECRET_KEY env var first.');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });

(async () => {
  const product = await stripe.products.update(PRODUCT_ID, {
    default_price: PRICE_ID,
  });
  console.log('✅  default_price set:', product.default_price);
})().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
