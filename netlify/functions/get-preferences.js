const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
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

  if (event.httpMethod !== 'GET') {
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

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Try to get existing preferences
    const { data, error } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('auth0_user_id', auth0UserId)
      .single();

    if (error && error.code === 'PGRST116') {
      // No row found — create defaults
      const timezone = event.queryStringParameters?.timezone || 'Europe/Madrid';
      const defaults = {
        auth0_user_id: auth0UserId,
        email: email || '',
        daily_notification: true,
        notification_hour: 9,
        timezone
      };

      const { data: newData, error: insertError } = await supabase
        .from('user_preferences')
        .insert(defaults)
        .select()
        .single();

      if (insertError) {
        console.error('Insert defaults error:', insertError);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          preferences: {
            daily_notification: newData.daily_notification,
            notification_hour: newData.notification_hour,
            timezone: newData.timezone
          },
          is_new: true
        })
      };
    }

    if (error) {
      console.error('Query error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        preferences: {
          daily_notification: data.daily_notification,
          notification_hour: data.notification_hour,
          timezone: data.timezone
        },
        is_new: false
      })
    };
  } catch (error) {
    console.error('get-preferences error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
