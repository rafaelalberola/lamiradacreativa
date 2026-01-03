// Create Stripe Checkout Session for Embedded Checkout
// Returns clientSecret to mount checkout on frontend

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Verify environment variables
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    console.error('Missing STRIPE_SECRET_KEY or STRIPE_PRICE_ID');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    // Get the origin for return URL
    const origin = event.headers.origin || event.headers.referer?.replace(/\/$/, '') || 'https://lamiradacreativa.com';

    // Create checkout session with embedded mode
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'payment',
      return_url: `${origin}/app?session_id={CHECKOUT_SESSION_ID}`,
      automatic_tax: { enabled: false },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ clientSecret: session.client_secret })
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

