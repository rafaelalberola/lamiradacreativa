// Stripe Webhook Handler
// Creates Auth0 users when a Stripe checkout is completed
// Uses passwordless (magic links) - no password needed
// Also tracks events to Amplitude and Mixpanel

const crypto = require('crypto');

// ============================================
// Analytics Tracking
// ============================================

const AMPLITUDE_API_KEY = '96fdd3ad4d76df488f862da2f26efd5c';
const MIXPANEL_TOKEN = 'c53f6532b5dbeda5ccde0ace3fb52c66';

async function trackAmplitudeEvent(eventName, eventProperties, userEmail) {
  try {
    const response = await fetch('https://api.eu.amplitude.com/2/httpapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: AMPLITUDE_API_KEY,
        events: [{
          event_type: eventName,
          user_id: userEmail,
          event_properties: eventProperties,
          time: Date.now()
        }]
      })
    });
    console.log(`[Amplitude] ${eventName}:`, response.status);
  } catch (error) {
    console.error('[Amplitude] Error:', error.message);
  }
}

async function trackMixpanelEvent(eventName, eventProperties, userEmail) {
  try {
    const eventData = {
      event: eventName,
      properties: {
        token: MIXPANEL_TOKEN,
        distinct_id: userEmail,
        time: Math.floor(Date.now() / 1000),
        ...eventProperties
      }
    };

    const base64Data = Buffer.from(JSON.stringify([eventData])).toString('base64');

    const response = await fetch('https://api-eu.mixpanel.com/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${base64Data}`
    });
    console.log(`[Mixpanel] ${eventName}:`, response.status);
  } catch (error) {
    console.error('[Mixpanel] Error:', error.message);
  }
}

async function trackEvent(eventName, properties, userEmail) {
  await Promise.all([
    trackAmplitudeEvent(eventName, properties, userEmail),
    trackMixpanelEvent(eventName, properties, userEmail)
  ]);
}

// Verify Stripe signature
function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  
  const elements = signature.split(',');
  const signatureHash = elements.find(e => e.startsWith('v1='))?.split('=')[1];
  const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
  
  if (!signatureHash || !timestamp) return false;
  
  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHash),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// Get Auth0 Management API token
async function getAuth0Token() {
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    })
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get Auth0 token: ${response.status}`);
  }
  
  const data = await response.json();
  return data.access_token;
}

// Create user in Auth0 for passwordless login
async function createAuth0User(email, name, stripeCustomerId) {
  const token = await getAuth0Token();
  
  // First, check if user already exists
  const searchResponse = await fetch(
    `https://${process.env.AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
    {
      headers: { 'Authorization': `Bearer ${token}` }
    }
  );
  
  const existingUsers = await searchResponse.json();
  
  if (existingUsers && existingUsers.length > 0) {
    console.log('User already exists:', email);
    // Update user metadata to mark as purchased
    const userId = existingUsers[0].user_id;
    await fetch(`https://${process.env.AUTH0_DOMAIN}/api/v2/users/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        app_metadata: {
          purchased: true,
          stripe_customer_id: stripeCustomerId,
          purchase_date: new Date().toISOString()
        }
      })
    });
    return { exists: true, email };
  }
  
  // Create new user for passwordless (email connection)
  // With passwordless, users don't need a password - they login via magic link
  const createResponse = await fetch(`https://${process.env.AUTH0_DOMAIN}/api/v2/users`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: email,
      name: name || email.split('@')[0],
      connection: 'email',  // Passwordless email connection
      email_verified: true,  // Passwordless verifies email automatically
      app_metadata: {
        purchased: true,
        stripe_customer_id: stripeCustomerId,
        purchase_date: new Date().toISOString()
      }
    })
  });
  
  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Failed to create Auth0 user: ${error}`);
  }
  
  const newUser = await createResponse.json();
  
  console.log('Passwordless user created:', email);
  return { created: true, email, user_id: newUser.user_id };
}

exports.handler = async (event, context) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }
  
  // Verify environment variables
  const requiredEnvVars = ['STRIPE_WEBHOOK_SECRET', 'AUTH0_DOMAIN', 'AUTH0_M2M_CLIENT_ID', 'AUTH0_M2M_CLIENT_SECRET'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  
  if (missingVars.length > 0) {
    console.error('Missing environment variables:', missingVars.join(', '));
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }
  
  // Verify Stripe signature
  const stripeSignature = event.headers['stripe-signature'];
  if (!verifyStripeSignature(event.body, stripeSignature, process.env.STRIPE_WEBHOOK_SECRET)) {
    console.error('Invalid Stripe signature');
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Invalid signature' })
    };
  }
  
  try {
    const stripeEvent = JSON.parse(event.body);
    const eventType = stripeEvent.type;
    const eventObject = stripeEvent.data.object;

    console.log('Received Stripe event:', eventType);

    // ============================================
    // Handle different Stripe events
    // ============================================

    // Payment Intent Created - User clicked "Pay" button
    if (eventType === 'payment_intent.created') {
      const email = eventObject.receipt_email || eventObject.metadata?.email || 'anonymous';
      const amount = eventObject.amount / 100;

      await trackEvent('Payment Started', {
        product: 'La Mirada Creativa',
        price: amount,
        currency: eventObject.currency,
        payment_method: eventObject.payment_method_types?.[0] || 'unknown',
        stripe_payment_intent_id: eventObject.id
      }, email);

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, event: 'payment_intent.created' })
      };
    }

    // Payment Intent Processing - Payment is being processed
    if (eventType === 'payment_intent.processing') {
      const email = eventObject.receipt_email || eventObject.metadata?.email || 'anonymous';
      const amount = eventObject.amount / 100;

      await trackEvent('Payment Processing', {
        product: 'La Mirada Creativa',
        price: amount,
        currency: eventObject.currency,
        stripe_payment_intent_id: eventObject.id
      }, email);

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, event: 'payment_intent.processing' })
      };
    }

    // Payment Intent Failed - Payment failed
    if (eventType === 'payment_intent.payment_failed') {
      const email = eventObject.receipt_email || eventObject.metadata?.email || 'anonymous';
      const amount = eventObject.amount / 100;
      const errorMessage = eventObject.last_payment_error?.message || 'Unknown error';

      await trackEvent('Payment Failed', {
        product: 'La Mirada Creativa',
        price: amount,
        currency: eventObject.currency,
        error_message: errorMessage,
        stripe_payment_intent_id: eventObject.id
      }, email);

      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, event: 'payment_intent.payment_failed' })
      };
    }

    // Checkout Session Completed - Successful purchase
    if (eventType !== 'checkout.session.completed') {
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, ignored: true })
      };
    }

    const session = eventObject;

    // Extract customer data
    const email = session.customer_details?.email || session.customer_email;
    const name = session.customer_details?.name || '';
    const stripeCustomerId = session.customer;
    const amount = session.amount_total / 100;
    const paymentMethod = session.payment_method_types?.[0] || 'unknown';

    if (!email) {
      console.error('No email found in checkout session');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No email found' })
      };
    }

    console.log('Processing purchase for:', email);

    // Track successful purchase in analytics
    await trackEvent('Purchase Completed (Server)', {
      product: 'La Mirada Creativa',
      price: amount,
      currency: session.currency,
      payment_method: paymentMethod,
      customer_email: email,
      customer_name: name,
      stripe_session_id: session.id
    }, email);

    // Create or update user in Auth0
    const result = await createAuth0User(email, name, stripeCustomerId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        ...result
      })
    };

  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
