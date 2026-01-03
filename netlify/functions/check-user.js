// Check if user exists in Auth0
// Called before login to validate email

// Get Auth0 Management API token
async function getAuth0Token() {
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to get Auth0 token');
  }
  
  const data = await response.json();
  return data.access_token;
}

exports.handler = async (event, context) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Verify environment variables
  if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_M2M_CLIENT_ID || !process.env.AUTH0_M2M_CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    const { email } = JSON.parse(event.body);
    
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    const token = await getAuth0Token();
    
    // Search for user by email
    const searchResponse = await fetch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!searchResponse.ok) {
      throw new Error('Failed to search users');
    }

    const users = await searchResponse.json();
    
    // Check if user exists and has purchased
    if (users && users.length > 0) {
      const user = users[0];
      const hasPurchased = user.app_metadata?.purchased === true;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          exists: true,
          purchased: hasPurchased
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ exists: false })
    };

  } catch (error) {
    console.error('Error checking user:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Error checking user' })
    };
  }
};

// Called before login to validate email

// Get Auth0 Management API token
async function getAuth0Token() {
  const response = await fetch(`https://${process.env.AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.AUTH0_M2M_CLIENT_ID,
      client_secret: process.env.AUTH0_M2M_CLIENT_SECRET,
      audience: `https://${process.env.AUTH0_DOMAIN}/api/v2/`,
      grant_type: 'client_credentials'
    })
  });
  
  if (!response.ok) {
    throw new Error('Failed to get Auth0 token');
  }
  
  const data = await response.json();
  return data.access_token;
}

exports.handler = async (event, context) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Verify environment variables
  if (!process.env.AUTH0_DOMAIN || !process.env.AUTH0_M2M_CLIENT_ID || !process.env.AUTH0_M2M_CLIENT_SECRET) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    const { email } = JSON.parse(event.body);
    
    if (!email) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email is required' })
      };
    }

    const token = await getAuth0Token();
    
    // Search for user by email
    const searchResponse = await fetch(
      `https://${process.env.AUTH0_DOMAIN}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      {
        headers: { 'Authorization': `Bearer ${token}` }
      }
    );

    if (!searchResponse.ok) {
      throw new Error('Failed to search users');
    }

    const users = await searchResponse.json();
    
    // Check if user exists and has purchased
    if (users && users.length > 0) {
      const user = users[0];
      const hasPurchased = user.app_metadata?.purchased === true;
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          exists: true,
          purchased: hasPurchased
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ exists: false })
    };

  } catch (error) {
    console.error('Error checking user:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Error checking user' })
    };
  }
};




