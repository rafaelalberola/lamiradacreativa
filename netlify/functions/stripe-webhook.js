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

async function trackAmplitudeEvent(eventName, eventProperties, userEmail, deviceId = null) {
  try {
    const eventPayload = {
      event_type: eventName,
      user_id: userEmail,
      event_properties: eventProperties,
      time: Date.now()
    };

    // Include device_id to link with anonymous client-side events
    if (deviceId) {
      eventPayload.device_id = deviceId;
    }

    const response = await fetch('https://api.eu.amplitude.com/2/httpapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: AMPLITUDE_API_KEY,
        events: [eventPayload]
      })
    });
    console.log(`[Amplitude] ${eventName}:`, response.status, deviceId ? `(device_id: ${deviceId})` : '');
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

async function trackEvent(eventName, properties, userEmail, deviceId = null) {
  await Promise.all([
    trackAmplitudeEvent(eventName, properties, userEmail, deviceId),
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

// ============================================
// POST-PURCHASE EMAIL (Resend + PDF attachment)
// ============================================
const fs = require('fs');
const path = require('path');

function buildEmailHtml(name, email) {
  const firstName = name ? name.split(' ')[0] : '';
  const greeting = firstName ? `Hola ${firstName},` : 'Hola,';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:4px;overflow:hidden;max-width:600px;">

<!-- Header -->
<tr><td style="background:#111111;padding:32px 40px;text-align:center;">
  <span style="font-family:monospace;font-size:20px;font-weight:bold;color:#F5F5F7;letter-spacing:1px;">LA MIRADA CREATIVA</span>
</td></tr>

<!-- Body -->
<tr><td style="padding:40px;">
  <p style="font-size:16px;color:#111111;margin:0 0 20px;line-height:1.6;">${greeting}</p>
  <p style="font-size:15px;color:#111111;margin:0 0 24px;line-height:1.6;">Gracias por tu compra. Ya tienes acceso a <strong>La Mirada Creativa</strong>: 365 dias de entrenamiento visual para desarrollar tu ojo fotografico.</p>

  <!-- PDF Section -->
  <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;padding:24px;margin:0 0 28px;">
    <p style="font-size:14px;color:#111111;margin:0 0 8px;font-weight:600;">PDF adjunto</p>
    <p style="font-size:13px;color:#555555;margin:0;line-height:1.5;">Hemos adjuntado el PDF con los 365 ejercicios a este email. Guardalo en tu dispositivo para tenerlo siempre a mano.</p>
  </div>

  <!-- App Access Section -->
  <div style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;padding:24px;margin:0 0 28px;">
    <p style="font-size:14px;color:#111111;margin:0 0 12px;font-weight:600;">Accede a la app</p>
    <p style="font-size:13px;color:#555555;margin:0 0 16px;line-height:1.5;">Tambien puedes usar la app interactiva desde el navegador:</p>
    <ol style="font-size:13px;color:#555555;margin:0 0 16px;padding-left:20px;line-height:1.8;">
      <li>Entra en <a href="https://lamiradacreativa.com/app" style="color:#FF5006;">lamiradacreativa.com/app</a></li>
      <li>Introduce tu email de compra: <strong style="color:#111111;">${email}</strong></li>
      <li>Recibiras un codigo de verificacion en tu bandeja</li>
      <li>Introduce el codigo y listo</li>
    </ol>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr><td>
      <a href="https://lamiradacreativa.com/app" style="display:inline-block;background:#FF5006;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:12px 28px;border-radius:2px;">Acceder a la app</a>
    </td></tr></table>
  </div>

  <p style="font-size:13px;color:#888888;margin:0;line-height:1.5;">Si tienes alguna duda, responde a este email directamente.</p>
</td></tr>

<!-- Footer -->
<tr><td style="padding:24px 40px;border-top:1px solid #e0e0e0;">
  <p style="font-size:12px;color:#888888;margin:0;text-align:center;">La Mirada Creativa &mdash; Rafael A.</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

async function sendPurchaseEmail(email, name) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] RESEND_API_KEY not configured, skipping email');
    return;
  }

  try {
    // Read PDF for attachment
    const pdfPath = path.join(__dirname, 'assets', 'la-mirada-creativa.pdf');
    let pdfBase64 = null;

    try {
      const pdfBuffer = fs.readFileSync(pdfPath);
      pdfBase64 = pdfBuffer.toString('base64');
      console.log('[Email] PDF loaded, size:', Math.round(pdfBuffer.length / 1024), 'KB');
    } catch (pdfErr) {
      console.error('[Email] Could not read PDF:', pdfErr.message);
    }

    const emailPayload = {
      from: process.env.RESEND_FROM || 'La Mirada Creativa <hola@lamiradacreativa.com>',
      to: [email],
      subject: 'Tu copia de La Mirada Creativa',
      html: buildEmailHtml(name, email)
    };

    // Attach PDF if available
    if (pdfBase64) {
      emailPayload.attachments = [{
        filename: 'La-Mirada-Creativa.pdf',
        content: pdfBase64
      }];
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailPayload)
    });

    const result = await response.json();
    console.log('[Email] Resend response:', response.status, JSON.stringify(result));
  } catch (error) {
    console.error('[Email] Error sending email:', error.message);
    // Do NOT throw - email failure should not fail the webhook
  }
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

    // Extract UTM data and device_id from session metadata
    const metadata = session.metadata || {};
    const trafficSource = metadata.traffic_source || 'organic';
    const utmSource = metadata.utm_source || null;
    const utmMedium = metadata.utm_medium || null;
    const utmCampaign = metadata.utm_campaign || null;
    const amplitudeDeviceId = metadata.amplitude_device_id || null;

    console.log('Traffic source:', trafficSource, '| UTM:', utmSource, utmMedium, utmCampaign);
    console.log('Amplitude device_id:', amplitudeDeviceId);

    // Track successful purchase in analytics with campaign data
    // Include device_id to link server event with client-side anonymous events
    await trackEvent('Purchase Completed (Server)', {
      product: 'La Mirada Creativa',
      price: amount,
      currency: session.currency,
      payment_method: paymentMethod,
      customer_email: email,
      customer_name: name,
      stripe_session_id: session.id,
      // Campaign tracking
      traffic_source: trafficSource,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_term: metadata.utm_term || null,
      utm_content: metadata.utm_content || null,
      fbclid: metadata.fbclid || null,
      gclid: metadata.gclid || null,
      acquisition_type: trafficSource !== 'organic' ? 'Paid' : 'Organic',
      tracking_version: '2'
    }, email, amplitudeDeviceId);

    // Create or update user in Auth0
    const result = await createAuth0User(email, name, stripeCustomerId);

    // Send purchase confirmation email with PDF (non-blocking on failure)
    await sendPurchaseEmail(email, name);

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
