const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('verifyUser: missing or malformed Authorization header');
    return null;
  }
  const token = authHeader.replace('Bearer ', '');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/userinfo`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const userInfo = await response.json();
        return userInfo; // Return full userInfo (sub, email, etc.)
      }
      const body = await response.text().catch(() => '');
      console.warn(`verifyUser: Auth0 /userinfo returned ${response.status} (attempt ${attempt + 1}):`, body.slice(0, 200));
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return null;
    } catch (err) {
      console.error(`verifyUser: fetch error (attempt ${attempt + 1}):`, err.message);
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      return null;
    }
  }
  return null;
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
