// Import exercises from app/data.js into Supabase
// Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-exercises.js

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Parse data.js — it uses window.CARDS and window.CARD_STYLES
// We only need CARDS for the import
function parseDataJs() {
  const filePath = path.join(__dirname, '..', 'app', 'data.js');
  const content = fs.readFileSync(filePath, 'utf-8');

  // Create a mock window object and evaluate the file
  const window = {};
  const fn = new Function('window', content);
  fn(window);

  return window.CARDS;
}

async function importExercises() {
  console.log('Parsing app/data.js...');
  const cards = parseDataJs();
  console.log(`Found ${cards.length} cards`);

  // Map cards to exercises table format
  const exercises = cards.map(card => ({
    id: card.id,
    type: card.type,
    style: card.style,
    day: card.day || null,
    block: card.block || null,
    block_number: card.blockNumber || null,
    title: card.title,
    subtitle: card.subtitle || null,
    icon: card.icon || null,
    description: card.desc || null,
    is_free: card.day ? card.day <= 7 : false
  }));

  // Insert in batches of 50
  const batchSize = 50;
  let inserted = 0;

  for (let i = 0; i < exercises.length; i += batchSize) {
    const batch = exercises.slice(i, i + batchSize);
    const { error } = await supabase
      .from('exercises')
      .upsert(batch, { onConflict: 'id' });

    if (error) {
      console.error(`Error inserting batch ${i / batchSize + 1}:`, error.message);
      process.exit(1);
    }

    inserted += batch.length;
    console.log(`Inserted ${inserted}/${exercises.length}`);
  }

  // Verify
  const { count } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true });

  const { count: freeCount } = await supabase
    .from('exercises')
    .select('*', { count: 'exact', head: true })
    .eq('is_free', true);

  console.log(`\nDone! ${count} exercises in DB, ${freeCount} marked as free (is_free=true)`);
}

importExercises().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
