const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // Allow both GET (email link click) and POST
  const token = event.queryStringParameters?.token;

  if (!token) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Enlace no válido</h2><p>Este enlace de baja no es válido.</p></body></html>'
    };
  }

  try {
    const requiredVars = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      console.error('Missing env vars:', missing);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Error del servidor</h2><p>Inténtalo de nuevo más tarde.</p></body></html>'
      };
    }

    // Decode auth0_user_id from token
    let auth0UserId;
    try {
      auth0UserId = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Enlace no válido</h2><p>Este enlace de baja no es válido.</p></body></html>'
      };
    }

    if (!auth0UserId || !auth0UserId.includes('|')) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Enlace no válido</h2><p>Este enlace de baja no es válido.</p></body></html>'
      };
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { error } = await supabase
      .from('user_preferences')
      .update({ daily_notification: false, updated_at: new Date().toISOString() })
      .eq('auth0_user_id', auth0UserId);

    if (error) {
      console.error('Unsubscribe error:', error);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja confirmada</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:60px 20px;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;background:#f7f7f7;">
  <div style="max-width:480px;margin:0 auto;background:#fff;padding:40px;border-radius:12px;">
    <h2 style="margin:0 0 16px;color:#1A1A1A;">Listo</h2>
    <p style="margin:0 0 24px;color:#555;line-height:1.6;">
      Has desactivado las notificaciones diarias. No recibirás más emails de recordatorio.
    </p>
    <p style="margin:0;color:#888;font-size:14px;">
      Puedes reactivarlas en cualquier momento desde <a href="https://lamiradacreativa.com/app/" style="color:#FF7442;">la app</a>.
    </p>
  </div>
</body>
</html>`
    };
  } catch (error) {
    console.error('unsubscribe-notification error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<html><body style="font-family:sans-serif;text-align:center;padding:60px 20px;"><h2>Error</h2><p>Algo salió mal. Inténtalo de nuevo.</p></body></html>'
    };
  }
};
