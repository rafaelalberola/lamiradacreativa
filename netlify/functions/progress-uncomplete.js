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

/**
 * Recalculate streak from scratch by analyzing all completion dates.
 * Returns { current_streak, longest_streak, last_completed_date, total_completed }
 */
function recalculateStreak(completionDates, timezone) {
  if (!completionDates || completionDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_completed_date: null, total_completed: 0 };
  }

  // Get unique dates in user's timezone, sorted ascending
  const dateSet = new Set();
  for (const ts of completionDates) {
    const d = new Date(ts);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    dateSet.add(dateStr);
  }

  const uniqueDates = Array.from(dateSet).sort();
  const totalCompleted = completionDates.length; // total exercises, not unique dates

  if (uniqueDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_completed_date: null, total_completed: 0 };
  }

  // Walk through sorted dates computing consecutive chains
  let longestStreak = 1;
  let chainLength = 1;

  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1] + 'T12:00:00Z');
    const curr = new Date(uniqueDates[i] + 'T12:00:00Z');
    const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      chainLength++;
    } else {
      longestStreak = Math.max(longestStreak, chainLength);
      chainLength = 1;
    }
  }
  longestStreak = Math.max(longestStreak, chainLength);

  // Determine current streak: walk backwards from today
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: timezone });

  const lastCompletedDate = uniqueDates[uniqueDates.length - 1];

  let currentStreak = 0;
  if (lastCompletedDate === todayStr || lastCompletedDate === yesterdayStr) {
    // Walk backwards from the last date to count consecutive days
    currentStreak = 1;
    for (let i = uniqueDates.length - 2; i >= 0; i--) {
      const curr = new Date(uniqueDates[i + 1] + 'T12:00:00Z');
      const prev = new Date(uniqueDates[i] + 'T12:00:00Z');
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return {
    current_streak: currentStreak,
    longest_streak: longestStreak,
    last_completed_date: lastCompletedDate,
    total_completed: totalCompleted
  };
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

    // Delete the progress entry
    const { error: deleteError } = await supabase
      .from('progress')
      .delete()
      .eq('auth0_user_id', auth0UserId)
      .eq('exercise_day', exercise_day);

    if (deleteError) {
      console.error('Progress delete error:', deleteError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    // Get all remaining completions for full streak recalculation
    const { data: allProgress, error: allError } = await supabase
      .from('progress')
      .select('completed_at')
      .eq('auth0_user_id', auth0UserId);

    if (allError) {
      console.error('Progress fetch error:', allError);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database error' }) };
    }

    const completionDates = (allProgress || []).map(r => r.completed_at);
    const streakResult = recalculateStreak(completionDates, timezone);

    // Upsert streak
    const { error: streakUpsertError } = await supabase
      .from('streaks')
      .upsert({
        auth0_user_id: auth0UserId,
        current_streak: streakResult.current_streak,
        longest_streak: streakResult.longest_streak,
        last_completed_date: streakResult.last_completed_date,
        total_completed: streakResult.total_completed
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
          current: streakResult.current_streak,
          longest: streakResult.longest_streak,
          last_completed_date: streakResult.last_completed_date
        },
        total_completed: streakResult.total_completed
      })
    };
  } catch (error) {
    console.error('progress-uncomplete error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

// Export for testing
if (typeof module !== 'undefined') {
  module.exports.recalculateStreak = recalculateStreak;
}
