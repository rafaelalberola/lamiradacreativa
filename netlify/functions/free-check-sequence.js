// Free Trial Sequence Status Check
// GET /.netlify/functions/free-check-sequence?email=user@example.com
// Returns the sequence status for a given free user (admin/debug utility)

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const email = (event.queryStringParameters?.email || '').trim().toLowerCase();

  if (!email) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Email parameter required' })
    };
  }

  try {
    // Find user
    const { data: user, error: userError } = await supabase
      .from('free_users')
      .select('id, email, converted, created_at')
      .eq('email', email)
      .maybeSingle();

    if (userError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error' })
      };
    }

    if (!user) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    // Get sequence
    const { data: sequence, error: seqError } = await supabase
      .from('email_sequence')
      .select('step, scheduled_for, sent_at, opened_at, clicked_at')
      .eq('free_user_id', user.id)
      .order('step', { ascending: true });

    if (seqError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        user: {
          email: user.email,
          converted: user.converted,
          registered_at: user.created_at
        },
        sequence: sequence || []
      })
    };

  } catch (error) {
    console.error('[Free Check] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal error' })
    };
  }
};
