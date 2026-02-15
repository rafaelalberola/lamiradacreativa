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

function getBlockForDay(day) {
  if (day >= 1 && day <= 90) return 'tecnica';
  if (day >= 91 && day <= 180) return 'sensible';
  if (day >= 181 && day <= 270) return 'conceptual';
  if (day >= 271 && day <= 365) return 'propia';
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

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Get completed exercises
    const { data: progressData, error: progressError } = await supabase
      .from('progress')
      .select('exercise_day')
      .eq('auth0_user_id', auth0UserId);

    if (progressError) {
      console.error('Progress query error:', progressError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    const completedDays = (progressData || []).map(r => r.exercise_day).sort((a, b) => a - b);

    // Get streak data
    const { data: streakData, error: streakError } = await supabase
      .from('streaks')
      .select('*')
      .eq('auth0_user_id', auth0UserId)
      .single();

    if (streakError && streakError.code !== 'PGRST116') {
      // PGRST116 = no rows found, which is fine for new users
      console.error('Streak query error:', streakError);
    }

    const streak = streakData || { current_streak: 0, longest_streak: 0, last_completed_date: null, total_completed: 0 };

    // Check if streak has lapsed (last_completed_date is before yesterday)
    let currentStreak = streak.current_streak;
    if (streak.last_completed_date) {
      const timezone = event.queryStringParameters?.timezone || 'Europe/Madrid';
      const now = new Date();
      const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: timezone });

      if (streak.last_completed_date !== todayStr && streak.last_completed_date !== yesterdayStr) {
        currentStreak = 0;
      }
    }

    // Compute by_block counts
    const completedSet = new Set(completedDays);
    const byBlock = { tecnica: 0, sensible: 0, conceptual: 0, propia: 0 };
    for (const day of completedDays) {
      const block = getBlockForDay(day);
      if (block) byBlock[block]++;
    }

    // Find next exercise (first uncompleted day 1-365)
    let nextExercise = null;
    for (let d = 1; d <= 365; d++) {
      if (!completedSet.has(d)) {
        nextExercise = d;
        break;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        completed_days: completedDays,
        streak: {
          current: currentStreak,
          longest: streak.longest_streak,
          last_completed_date: streak.last_completed_date
        },
        total_completed: completedDays.length,
        next_exercise: nextExercise,
        by_block: byBlock
      })
    };
  } catch (error) {
    console.error('progress-get error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
