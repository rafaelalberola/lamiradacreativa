// Central email suppression list.
//
// Any address listed here will NEVER receive email from any Netlify function:
// daily reminder, weekly summary, free-trial drip, welcome, purchase/feedback,
// or the admin daily report. The check is case-insensitive and trims whitespace.
//
// 2026-06-14: owner (helloimrafa@gmail.com) opted out of ALL La Mirada Creativa
// emails to that address. Delete an address below to resume delivery to it.

const SUPPRESSED = new Set([
  'helloimrafa@gmail.com',
]);

function isSuppressed(email) {
  if (!email || typeof email !== 'string') return false;
  return SUPPRESSED.has(email.trim().toLowerCase());
}

module.exports = { isSuppressed, SUPPRESSED };
