// Stripe Webhook Handler
// Creates Auth0 users when a Stripe checkout is completed
// Uses passwordless (magic links) - no password needed

const crypto = require('crypto');

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
    
    // Only process completed checkouts
    if (stripeEvent.type !== 'checkout.session.completed') {
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, ignored: true })
      };
    }
    
    const session = stripeEvent.data.object;
    
    // Extract customer data
    const email = session.customer_details?.email || session.customer_email;
    const name = session.customer_details?.name || '';
    const stripeCustomerId = session.customer;
    
    if (!email) {
      console.error('No email found in checkout session');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No email found' })
      };
    }
    
    console.log('Processing purchase for:', email);
    
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
