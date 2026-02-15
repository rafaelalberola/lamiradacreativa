/**
 * Unit tests for streak calculation logic.
 * Run with: node tests/streak.test.js
 *
 * The recalculateStreak function is duplicated here to avoid
 * importing the Netlify function (which requires @supabase/supabase-js).
 * Keep in sync with netlify/functions/progress-uncomplete.js
 */

const TIMEZONE = 'Europe/Madrid';

/**
 * Recalculate streak from scratch by analyzing all completion dates.
 * (Copy from netlify/functions/progress-uncomplete.js)
 */
function recalculateStreak(completionDates, timezone) {
  if (!completionDates || completionDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_completed_date: null, total_completed: 0 };
  }

  const dateSet = new Set();
  for (const ts of completionDates) {
    const d = new Date(ts);
    const dateStr = d.toLocaleDateString('en-CA', { timeZone: timezone });
    dateSet.add(dateStr);
  }

  const uniqueDates = Array.from(dateSet).sort();
  const totalCompleted = completionDates.length;

  if (uniqueDates.length === 0) {
    return { current_streak: 0, longest_streak: 0, last_completed_date: null, total_completed: 0 };
  }

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

  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toLocaleDateString('en-CA', { timeZone: timezone });

  const lastCompletedDate = uniqueDates[uniqueDates.length - 1];

  let currentStreak = 0;
  if (lastCompletedDate === todayStr || lastCompletedDate === yesterdayStr) {
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

// ============================================
// HELPERS
// ============================================
function getDateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

let passed = 0;
let failed = 0;

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${testName}`);
  } else {
    failed++;
    console.error(`  ✗ ${testName} — expected ${expected}, got ${actual}`);
  }
}

// ============================================
// TEST SUITE
// ============================================

console.log('\n=== Streak Calculation Tests ===\n');

console.log('Test 1: No completions');
{
  const result = recalculateStreak([], TIMEZONE);
  assertEqual(result.current_streak, 0, 'current_streak = 0');
  assertEqual(result.longest_streak, 0, 'longest_streak = 0');
  assertEqual(result.last_completed_date, null, 'last_completed_date = null');
  assertEqual(result.total_completed, 0, 'total_completed = 0');
}

console.log('\nTest 2: First activity ever (today)');
{
  const result = recalculateStreak([getDateStr(0)], TIMEZONE);
  assertEqual(result.current_streak, 1, 'current_streak = 1');
  assertEqual(result.longest_streak, 1, 'longest_streak = 1');
  assertEqual(result.total_completed, 1, 'total_completed = 1');
}

console.log('\nTest 3: Activity yesterday and today');
{
  const dates = [getDateStr(1), getDateStr(0)];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 2, 'current_streak = 2');
  assertEqual(result.longest_streak, 2, 'longest_streak = 2');
}

console.log('\nTest 4: Activity 2 days ago, NOT yesterday, today');
{
  const dates = [getDateStr(2), getDateStr(0)];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 1, 'current_streak = 1 (gap breaks streak)');
  assertEqual(result.longest_streak, 1, 'longest_streak = 1');
}

console.log('\nTest 5: 3 exercises today, 2 yesterday = streak 2 (not 5)');
{
  const dates = [
    getDateStr(1), getDateStr(1),
    getDateStr(0), getDateStr(0), getDateStr(0)
  ];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 2, 'current_streak = 2');
  assertEqual(result.longest_streak, 2, 'longest_streak = 2');
  assertEqual(result.total_completed, 5, 'total_completed = 5 (all exercises counted)');
}

console.log('\nTest 6: 5-day streak, remove today → streak = 4 (yesterday still active)');
{
  const dates = [getDateStr(4), getDateStr(3), getDateStr(2), getDateStr(1)];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 4, 'current_streak = 4 (yesterday is last day)');
  assertEqual(result.longest_streak, 4, 'longest_streak = 4');
}

console.log('\nTest 7: Activity 3 consecutive days ending 3 days ago → current = 0');
{
  const dates = [getDateStr(5), getDateStr(4), getDateStr(3)];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 0, 'current_streak = 0 (lapsed)');
  assertEqual(result.longest_streak, 3, 'longest_streak = 3 (historical)');
}

console.log('\nTest 8: Old 10-day streak + new 2-day streak');
{
  const dates = [];
  for (let i = 20; i >= 11; i--) dates.push(getDateStr(i));
  dates.push(getDateStr(1));
  dates.push(getDateStr(0));
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 2, 'current_streak = 2');
  assertEqual(result.longest_streak, 10, 'longest_streak = 10 (historical)');
}

console.log('\nTest 9: Single exercise only yesterday');
{
  const dates = [getDateStr(1)];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 1, 'current_streak = 1 (yesterday counts)');
  assertEqual(result.longest_streak, 1, 'longest_streak = 1');
}

console.log('\nTest 10: Null input');
{
  const result = recalculateStreak(null, TIMEZONE);
  assertEqual(result.current_streak, 0, 'current_streak = 0');
  assertEqual(result.longest_streak, 0, 'longest_streak = 0');
}

console.log('\nTest 11: Complex: days 10,9,8 (gap) 5,4 (gap) 1,0');
{
  const dates = [
    getDateStr(10), getDateStr(9), getDateStr(8),
    getDateStr(5), getDateStr(4),
    getDateStr(1), getDateStr(0)
  ];
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 2, 'current_streak = 2 (today + yesterday)');
  assertEqual(result.longest_streak, 3, 'longest_streak = 3 (days 10-8)');
}

console.log('\nTest 12: Full 365-day streak');
{
  const dates = [];
  for (let i = 364; i >= 0; i--) dates.push(getDateStr(i));
  const result = recalculateStreak(dates, TIMEZONE);
  assertEqual(result.current_streak, 365, 'current_streak = 365');
  assertEqual(result.longest_streak, 365, 'longest_streak = 365');
}

// ============================================
// RESULTS
// ============================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
