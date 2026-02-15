-- ═══════════════════════════════════════════════════════════
-- NOTIFICATION PREFERENCES TABLE
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

CREATE TABLE user_preferences (
  auth0_user_id text PRIMARY KEY,
  email text NOT NULL,
  daily_notification boolean DEFAULT true,
  notification_hour int DEFAULT 9,  -- hora local (0-23)
  timezone text DEFAULT 'Europe/Madrid',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Lectura desde frontend (filtrada por auth0_user_id en la query)
CREATE POLICY "Users read own preferences" ON user_preferences
  FOR SELECT USING (true);

-- Escrituras solo via Netlify Functions (service_role)
CREATE POLICY "Service role full access preferences" ON user_preferences
  FOR ALL USING (true) WITH CHECK (true);

-- Índice para la scheduled function: buscar usuarios con notificaciones activas por hora
CREATE INDEX idx_preferences_notification ON user_preferences(daily_notification, notification_hour)
  WHERE daily_notification = true;
