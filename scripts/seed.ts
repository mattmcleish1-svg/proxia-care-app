/**
 * Proxia Care demo seed script.
 *
 * Prerequisites:
 *   1. Run scripts/schema.sql in the Supabase SQL Editor first.
 *   2. Add SUPABASE_SERVICE_ROLE_KEY to your .env.local file.
 *
 * Run with:
 *   npm run seed
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const USER_EMAIL = 'mattmcleish1@gmail.com'

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ─── helpers ──────────────────────────────────────────────────────────────────

function rand(min: number, max: number, decimals = 0): number {
  const v = Math.random() * (max - min) + min
  return decimals > 0 ? parseFloat(v.toFixed(decimals)) : Math.floor(v)
}

function isoAt(daysBack: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

function dateStr(daysBack: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysBack)
  return d.toISOString().split('T')[0]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function must<T>(label: string, thenable: PromiseLike<any>): Promise<T> {
  const { data, error } = await thenable
  if (error) {
    console.error(`✗ ${label}:`, error)
    process.exit(1)
  }
  return data as T
}

// ─── row types ────────────────────────────────────────────────────────────────

type HomeRow = { id: string; name: string; address: string; city: string; state: string }
type SensorRow = { id: string; name: string; sensor_type: string; location: string; home_id: string }

// ─── seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱  Starting Proxia Care seed…\n')

  // ── 1. Verify user ──────────────────────────────────────────────────────────
  const {
    data: { users },
    error: usersError,
  } = await supabase.auth.admin.listUsers()
  if (usersError) {
    console.error('✗ Could not list auth users:', usersError)
    process.exit(1)
  }
  const user = users.find((u) => u.email === USER_EMAIL)
  if (!user) {
    console.error(`✗ No user found with email ${USER_EMAIL}. Create the account via the login page first.`)
    process.exit(1)
  }
  console.log(`✓ User: ${user.email} (${user.id})`)

  // ── 2. Check for existing data ──────────────────────────────────────────────
  const { data: existing } = await supabase.from('homes').select('id').limit(1)
  if (existing && existing.length > 0) {
    console.log('ℹ  Demo data already exists. To re-seed, delete all rows from the tables first.')
    process.exit(0)
  }

  // ── 3. Create home ──────────────────────────────────────────────────────────
  const home = await must<HomeRow>('Create home', supabase
    .from('homes')
    .insert({ name: 'The Morrison Home', address: '4521 E Camelback Rd', city: 'Scottsdale', state: 'AZ' })
    .select()
    .single())
  console.log(`✓ Home: ${home.name} (${home.id})`)

  // ── 4. Link user as daughter ────────────────────────────────────────────────
  await must<unknown>('Create home member', supabase
    .from('home_members')
    .insert({ home_id: home.id, user_id: user.id, role: 'family', relationship: 'daughter' })
    .select()
    .single())
  console.log('✓ Linked user as daughter')

  // ── 5. Create sensors ───────────────────────────────────────────────────────
  const sensorDefs = [
    { name: 'Bathroom Fall Sensor',     sensor_type: 'presence', location: 'bathroom' },
    { name: 'Bedroom Fall Sensor',      sensor_type: 'presence', location: 'bedroom' },
    { name: 'Kitchen Motion',           sensor_type: 'motion',   location: 'kitchen' },
    { name: 'Living Room Motion',       sensor_type: 'motion',   location: 'living_room' },
    { name: 'Front Door',               sensor_type: 'door',     location: 'front_door' },
    { name: 'Bathroom Temperature',     sensor_type: 'temp',     location: 'bathroom' },
    { name: 'Living Room Temperature',  sensor_type: 'temp',     location: 'living_room' },
    { name: 'AC Unit',                  sensor_type: 'plug',     location: 'ac_unit' },
  ]

  const sensors = await must<SensorRow[]>('Create sensors', supabase
    .from('sensors')
    .insert(sensorDefs.map((s) => ({ ...s, home_id: home.id })))
    .select())
  console.log(`✓ ${sensors.length} sensors created`)

  // Build lookup map: "location_type" → sensor
  const smap: Record<string, { id: string }> = {}
  for (const s of sensors) smap[`${s.location}_${s.sensor_type}`] = s
  const sid = (loc: string, type: string) => smap[`${loc}_${type}`].id

  // ── 6. Generate 7 days of sensor readings ───────────────────────────────────
  const readings: Array<{ sensor_id: string; value: number; unit: string; recorded_at: string }> = []

  for (let day = 6; day >= 0; day--) {
    // Temperature: every 30 min, 70-74 °F with a mild diurnal curve
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const curve = Math.sin(((h - 6) / 24) * Math.PI * 2) * 1.5
        readings.push({ sensor_id: sid('living_room', 'temp'), value: parseFloat((71.5 + curve + rand(-0.5, 0.5, 2)).toFixed(1)), unit: '°F', recorded_at: isoAt(day, h, m) })
        readings.push({ sensor_id: sid('bathroom', 'temp'),    value: parseFloat((72.0 + curve + rand(-0.5, 0.5, 2)).toFixed(1)), unit: '°F', recorded_at: isoAt(day, h, m) })
      }
    }

    // AC plug: on during the heat of the day (10 AM–10 PM), 900–1300 W
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 30]) {
        const on = h >= 10 && h < 22
        readings.push({ sensor_id: sid('ac_unit', 'plug'), value: on ? rand(900, 1300) : 0, unit: 'W', recorded_at: isoAt(day, h, m) })
      }
    }

    // Kitchen motion: breakfast (7-9), lunch (11-13), dinner (17-19)
    for (const h of [7, 7, 8, 8, 9, 11, 12, 12, 17, 17, 18, 18, 19]) {
      readings.push({ sensor_id: sid('kitchen', 'motion'), value: 1, unit: 'event', recorded_at: isoAt(day, h, rand(0, 59)) })
    }

    // Living room motion: morning, afternoon, evening
    for (const h of [7, 8, 9, 10, 13, 14, 18, 19, 20, 20, 21]) {
      readings.push({ sensor_id: sid('living_room', 'motion'), value: 1, unit: 'event', recorded_at: isoAt(day, h, rand(0, 59)) })
    }

    // Front door: 2–3 opens per day during daytime
    const doorCount = rand(2, 3)
    const doorHours = [9, 14, 17].slice(0, doorCount)
    for (const h of doorHours) {
      readings.push({ sensor_id: sid('front_door', 'door'), value: 1, unit: 'open', recorded_at: isoAt(day, h, rand(0, 20)) })
    }

    // Presence sensors (fall detection): no-fall readings a few times daily
    for (const h of [8, 14, 21]) {
      readings.push({ sensor_id: sid('bathroom', 'presence'), value: 0, unit: 'event', recorded_at: isoAt(day, h, 0) })
      readings.push({ sensor_id: sid('bedroom',  'presence'), value: 0, unit: 'event', recorded_at: isoAt(day, h, 0) })
    }
  }

  // Insert in batches of 500
  for (let i = 0; i < readings.length; i += 500) {
    const { error } = await supabase.from('sensor_readings').insert(readings.slice(i, i + 500))
    if (error) { console.error('✗ Batch insert failed:', error); process.exit(1) }
  }
  console.log(`✓ ${readings.length} sensor readings inserted`)

  // ── 7. Sleep summaries ──────────────────────────────────────────────────────
  const sleepRows = [
    { daysBack: 6, duration_hours: 7.5, quality_score: 82, breathing_disturbances: 2 },
    { daysBack: 5, duration_hours: 8.0, quality_score: 88, breathing_disturbances: 1 },
    { daysBack: 4, duration_hours: 6.5, quality_score: 72, breathing_disturbances: 4 },
    { daysBack: 3, duration_hours: 7.2, quality_score: 79, breathing_disturbances: 2 },
    { daysBack: 2, duration_hours: 7.8, quality_score: 85, breathing_disturbances: 1 },
    { daysBack: 1, duration_hours: 6.8, quality_score: 75, breathing_disturbances: 3 },
    { daysBack: 0, duration_hours: 7.4, quality_score: 81, breathing_disturbances: 2 },
  ]

  await must<unknown>('Insert sleep summaries', supabase
    .from('sleep_summaries')
    .insert(sleepRows.map(({ daysBack, ...rest }) => ({ home_id: home.id, date: dateStr(daysBack), ...rest })))
    .select())
  console.log(`✓ ${sleepRows.length} sleep summaries inserted`)

  // ── 8. Alerts ───────────────────────────────────────────────────────────────
  const alertRows = [
    {
      home_id:     home.id,
      sensor_id:   sid('living_room', 'temp'),
      severity:    'warning',
      title:       'High Temperature Alert',
      description: 'Living room temperature reached 83°F — above comfortable range. AC adjusted automatically.',
      is_resolved: true,
      created_at:  isoAt(4, 14, 22),
      resolved_at: isoAt(4, 14, 55),
    },
    {
      home_id:     home.id,
      sensor_id:   sid('front_door', 'door'),
      severity:    'warning',
      title:       'Front Door Opened at Night',
      description: 'Front door was opened at 2:14 AM. It closed again 3 minutes later.',
      is_resolved: true,
      created_at:  isoAt(2, 2, 14),
      resolved_at: isoAt(2, 2, 17),
    },
    {
      home_id:     home.id,
      sensor_id:   sid('kitchen', 'motion'),
      severity:    'info',
      title:       'Unusual Quiet Period Detected',
      description: 'No motion detected between 11 AM – 2 PM, outside of the typical rest window.',
      is_resolved: true,
      created_at:  isoAt(1, 14, 5),
      resolved_at: isoAt(1, 15, 0),
    },
  ]

  await must<unknown>('Insert alerts', supabase.from('alerts').insert(alertRows).select())
  console.log(`✓ ${alertRows.length} alerts inserted`)

  console.log('\n✅  Seed complete! Open the dashboard to see your demo data.')
}

seed().catch((err) => {
  console.error('\n✗ Unexpected error:', err)
  process.exit(1)
})
