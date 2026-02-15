const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('verifyUser: missing or malformed Authorization header');
    return null;
  }
  const token = authHeader.replace('Bearer ', '');

  try {
    // Decode JWT ID token (base64url payload)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.warn('verifyUser: token is not a valid JWT');
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // Verify issuer matches Auth0 domain
    const expectedIssuer = `https://${process.env.AUTH0_DOMAIN}/`;
    if (payload.iss !== expectedIssuer) {
      console.warn('verifyUser: issuer mismatch:', payload.iss, '!==', expectedIssuer);
      return null;
    }

    // Verify token is not expired
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.warn('verifyUser: token expired');
      return null;
    }

    if (!payload.sub) {
      console.warn('verifyUser: no sub claim in token');
      return null;
    }

    return { sub: payload.sub, email: payload.email || '' };
  } catch (err) {
    console.error('verifyUser: JWT decode error:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AUTH0_DOMAIN'];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.error('Missing env vars:', missing);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const userInfo = await verifyUser(event.headers.authorization || event.headers.Authorization);
    if (!userInfo) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const auth0UserId = userInfo.sub;
    const email = userInfo.email;

    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email not available in token' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { daily_notification, notification_hour, timezone } = body;

    // Validate notification_hour
    if (notification_hour !== undefined) {
      const hour = parseInt(notification_hour);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'notification_hour must be between 0 and 23' }) };
      }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Build update object with only provided fields
    const updateFields = { auth0_user_id: auth0UserId, email, updated_at: new Date().toISOString() };
    if (daily_notification !== undefined) updateFields.daily_notification = daily_notification;
    if (notification_hour !== undefined) updateFields.notification_hour = parseInt(notification_hour);
    if (timezone !== undefined) updateFields.timezone = timezone;

    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(updateFields, { onConflict: 'auth0_user_id' })
      .select()
      .single();

    if (error) {
      console.error('Upsert error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        preferences: {
          daily_notification: data.daily_notification,
          notification_hour: data.notification_hour,
          timezone: data.timezone
        }
      })
    };
  } catch (error) {
    console.error('save-preferences error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
