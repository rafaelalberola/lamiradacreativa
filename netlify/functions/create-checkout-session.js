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

    // Parse UTM data and device_id from request body
    let utm = {};
    let amplitudeDeviceId = null;
    try {
      const body = JSON.parse(event.body || '{}');
      utm = body.utm || {};
      amplitudeDeviceId = body.amplitude_device_id || null;
    } catch(e) {}

    // Build metadata with UTM parameters
    const metadata = {};
    if (utm.utm_source) metadata.utm_source = utm.utm_source;
    if (utm.utm_medium) metadata.utm_medium = utm.utm_medium;
    if (utm.utm_campaign) metadata.utm_campaign = utm.utm_campaign;
    if (utm.utm_term) metadata.utm_term = utm.utm_term;
    if (utm.utm_content) metadata.utm_content = utm.utm_content;
    if (utm.fbclid) metadata.fbclid = utm.fbclid;
    if (utm.gclid) metadata.gclid = utm.gclid;
    if (amplitudeDeviceId) metadata.amplitude_device_id = amplitudeDeviceId;

    // Determine traffic source type
    if (utm.fbclid || utm.utm_source === 'facebook') {
      metadata.traffic_source = 'facebook_ads';
    } else if (utm.gclid || utm.utm_source === 'google') {
      metadata.traffic_source = 'google_ads';
    } else if (utm.utm_source) {
      metadata.traffic_source = 'paid';
    } else {
      metadata.traffic_source = 'organic';
    }

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
      return_url: `${origin}/gracias?session_id={CHECKOUT_SESSION_ID}`,
      automatic_tax: { enabled: false },
      // Collect billing address which includes name
      billing_address_collection: 'required',
      // Allow discount codes
      allow_promotion_codes: true,
      // Store UTM data in session metadata
      metadata: metadata,
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

