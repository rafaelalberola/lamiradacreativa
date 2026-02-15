const { createClient } = require('@supabase/supabase-js');

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
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
        return userInfo.sub;
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

    const auth0UserId = await verifyUser(event.headers.authorization || event.headers.Authorization);
    if (!auth0UserId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const params = event.queryStringParameters || {};
    const year = parseInt(params.year);
    const month = parseInt(params.month);

    if (!year || !month || month < 1 || month > 12) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid year and month (1-12) are required' }) };
    }

    const timezone = params.timezone || 'Europe/Madrid';

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Get start and end of the requested month
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1)); // First day of next month

    // Query completions within the month range
    const { data: completions, error } = await supabase
      .from('progress')
      .select('exercise_day, completed_at')
      .eq('auth0_user_id', auth0UserId)
      .gte('completed_at', startDate.toISOString())
      .lt('completed_at', endDate.toISOString());

    if (error) {
      console.error('Calendar query error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    // Group by date in user's timezone
    const dayMap = {};
    for (const entry of (completions || [])) {
      const dateStr = new Date(entry.completed_at).toLocaleDateString('en-CA', { timeZone: timezone });
      if (!dayMap[dateStr]) {
        dayMap[dateStr] = 0;
      }
      dayMap[dateStr]++;
    }

    // Build days array for the full month
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      days.push({
        date: dateStr,
        count: dayMap[dateStr] || 0
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        year,
        month,
        days
      })
    };
  } catch (error) {
    console.error('progress-calendar error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
