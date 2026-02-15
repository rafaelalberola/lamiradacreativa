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

function getUserToday(timezone) {
  const now = new Date();
  return now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
}

function getUserYesterday(timezone) {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toLocaleDateString('en-CA', { timeZone: timezone });
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

    const auth0UserId = await verifyUser(event.headers.authorization || event.headers.Authorization);
    if (!auth0UserId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { exercise_day, timezone = 'Europe/Madrid' } = body;

    if (!exercise_day || !Number.isInteger(exercise_day) || exercise_day < 1 || exercise_day > 365) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'exercise_day must be an integer between 1 and 365' }) };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Upsert progress (idempotent — UNIQUE constraint prevents duplicates)
    const { error: insertError } = await supabase
      .from('progress')
      .upsert({
        auth0_user_id: auth0UserId,
        exercise_day: exercise_day,
        completed_at: new Date().toISOString()
      }, {
        onConflict: 'auth0_user_id,exercise_day'
      });

    if (insertError) {
      console.error('Progress insert error:', insertError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    // Count total completed
    const { count, error: countError } = await supabase
      .from('progress')
      .select('*', { count: 'exact', head: true })
      .eq('auth0_user_id', auth0UserId);

    if (countError) {
      console.error('Count error:', countError);
    }

    const totalCompleted = count || 0;

    // Get current streak data
    const { data: streakData, error: streakError } = await supabase
      .from('streaks')
      .select('*')
      .eq('auth0_user_id', auth0UserId)
      .single();

    if (streakError && streakError.code !== 'PGRST116') {
      console.error('Streak query error:', streakError);
    }

    const today = getUserToday(timezone);
    const yesterday = getUserYesterday(timezone);

    let currentStreak = 1;
    let longestStreak = 1;

    if (streakData) {
      const lastDate = streakData.last_completed_date;

      if (lastDate === today) {
        // Already completed something today — streak doesn't change
        currentStreak = streakData.current_streak;
        longestStreak = streakData.longest_streak;
      } else if (lastDate === yesterday) {
        // Consecutive day — increment streak
        currentStreak = streakData.current_streak + 1;
        longestStreak = Math.max(currentStreak, streakData.longest_streak);
      } else {
        // Gap — reset streak to 1
        currentStreak = 1;
        longestStreak = Math.max(1, streakData.longest_streak);
      }
    }

    // Upsert streak
    const { error: streakUpsertError } = await supabase
      .from('streaks')
      .upsert({
        auth0_user_id: auth0UserId,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        last_completed_date: today,
        total_completed: totalCompleted
      }, {
        onConflict: 'auth0_user_id'
      });

    if (streakUpsertError) {
      console.error('Streak upsert error:', streakUpsertError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        exercise_day: exercise_day,
        streak: {
          current: currentStreak,
          longest: longestStreak,
          last_completed_date: today
        },
        total_completed: totalCompleted
      })
    };
  } catch (error) {
    console.error('progress-complete error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
