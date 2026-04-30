-- Proxia Care: Run this in the Supabase SQL Editor before running the seed script.

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS homes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  address    TEXT,
  city       TEXT,
  state      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS home_members (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id      UUID REFERENCES homes(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'family',
  relationship TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(home_id, user_id)
);

CREATE TABLE IF NOT EXISTS sensors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id     UUID REFERENCES homes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sensor_type TEXT NOT NULL, -- presence | motion | door | temp | plug
  location    TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id   UUID REFERENCES sensors(id) ON DELETE CASCADE,
  value       NUMERIC NOT NULL,
  unit        TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sensor_readings_sensor_recorded
  ON sensor_readings(sensor_id, recorded_at DESC);

CREATE TABLE IF NOT EXISTS sleep_summaries (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id                UUID REFERENCES homes(id) ON DELETE CASCADE,
  date                   DATE NOT NULL,
  duration_hours         NUMERIC NOT NULL,
  quality_score          INTEGER NOT NULL,
  breathing_disturbances INTEGER DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(home_id, date)
);

CREATE TABLE IF NOT EXISTS alerts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_id     UUID REFERENCES homes(id) ON DELETE CASCADE,
  sensor_id   UUID REFERENCES sensors(id) ON DELETE SET NULL,
  severity    TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title       TEXT NOT NULL,
  description TEXT,
  is_resolved BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE homes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE home_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensors         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sleep_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts          ENABLE ROW LEVEL SECURITY;

-- Homes: visible to members of that home
CREATE POLICY "homes_select" ON homes
  FOR SELECT TO authenticated USING (
    id IN (SELECT home_id FROM home_members WHERE user_id = auth.uid())
  );

-- Home members: visible if you belong to the same home
CREATE POLICY "home_members_select" ON home_members
  FOR SELECT TO authenticated USING (
    home_id IN (SELECT home_id FROM home_members hm2 WHERE hm2.user_id = auth.uid())
  );

-- Sensors: visible to home members
CREATE POLICY "sensors_select" ON sensors
  FOR SELECT TO authenticated USING (
    home_id IN (SELECT home_id FROM home_members WHERE user_id = auth.uid())
  );

-- Sensor readings: visible to home members
CREATE POLICY "sensor_readings_select" ON sensor_readings
  FOR SELECT TO authenticated USING (
    sensor_id IN (
      SELECT s.id FROM sensors s
      JOIN home_members hm ON s.home_id = hm.home_id
      WHERE hm.user_id = auth.uid()
    )
  );

-- Sleep summaries: visible to home members
CREATE POLICY "sleep_summaries_select" ON sleep_summaries
  FOR SELECT TO authenticated USING (
    home_id IN (SELECT home_id FROM home_members WHERE user_id = auth.uid())
  );

-- Alerts: visible to home members
CREATE POLICY "alerts_select" ON alerts
  FOR SELECT TO authenticated USING (
    home_id IN (SELECT home_id FROM home_members WHERE user_id = auth.uid())
  );
