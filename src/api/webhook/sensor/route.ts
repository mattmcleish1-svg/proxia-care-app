import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Use service role key for webhook ingestion (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  // 1. Validate shared secret
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { home_id, entity_id, state, timestamp, attributes } = payload

  if (!home_id || !entity_id) {
    return NextResponse.json({ error: 'Missing home_id or entity_id' }, { status: 400 })
  }

  // 2. Look up sensor by external_id
  const { data: sensor, error: sensorError } = await supabase
    .from('sensors')
    .select('*')
    .eq('external_id', entity_id)
    .eq('home_id', home_id)
    .single()

  // If sensor not found by external_id, try matching by name
  if (sensorError || !sensor) {
    console.log(`Sensor not found for entity_id: ${entity_id}, home: ${home_id}`)
    return NextResponse.json({ error: 'Sensor not registered', entity_id }, { status: 404 })
  }

  // 3. Parse the value
  const numericValue = !isNaN(parseFloat(state)) ? parseFloat(state) : null
  const boolValue = state === 'on' || state === 'open' || state === 'detected' || state === true
  const recordedAt = timestamp || new Date().toISOString()

  // 4. Determine unit based on sensor type
  let unit = ''
  if (sensor.sensor_type === 'temp') unit = '°F'
  else if (sensor.sensor_type === 'plug') unit = 'W'
  else if (sensor.sensor_type === 'motion' || sensor.sensor_type === 'presence') unit = 'event'
  else if (sensor.sensor_type === 'door') unit = boolValue ? 'open' : 'closed'

  // 5. Insert reading
  const reading = {
    sensor_id: sensor.id,
    home_id: home_id,
    recorded_at: recordedAt,
    value: numericValue !== null ? numericValue : (boolValue ? 1 : 0),
    unit: unit,
  }

  const { error: insertError } = await supabase
    .from('sensor_readings')
    .insert(reading)

  if (insertError) {
    console.error('Failed to insert reading:', insertError)
    return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
  }

  // 6. Run alert rules
  const alerts = await evaluateAlertRules(sensor, reading, attributes)

  return NextResponse.json({
    ok: true,
    sensor: sensor.name,
    alerts_triggered: alerts.length,
  })
}

// ── Alert Rules ──────────────────────────────────────────────────────────────

interface AlertData {
  home_id: string
  sensor_id: string
  severity: string
  title: string
  description: string
}

async function evaluateAlertRules(
  sensor: { id: string; home_id: string; sensor_type: string; name: string; location: string },
  reading: { value: number; recorded_at: string },
  attributes: Record<string, unknown> | undefined
): Promise<AlertData[]> {
  const triggered: AlertData[] = []

  // Rule 1: High temperature
  if (sensor.sensor_type === 'temp' && reading.value >= 82) {
    const alert = {
      home_id: sensor.home_id,
      sensor_id: sensor.id,
      severity: reading.value >= 88 ? 'critical' : 'warning',
      title: `Indoor temperature is ${reading.value}°F`,
      description: `The ${sensor.name} is reading ${reading.value}°F. ${
        reading.value >= 88
          ? 'This is dangerously high — check AC status and home environment immediately.'
          : 'This is above comfortable range. Check that the AC is running.'
      }`,
    }
    await createAlert(alert)
    triggered.push(alert)
  }

  // Rule 2: AC failure (plug drawing no power while temp is elevated)
  if (sensor.sensor_type === 'plug' && reading.value === 0) {
    // Check if any temp sensor in this home is reading above 78
    const { data: recentTemp } = await supabase
      .from('sensor_readings')
      .select('value')
      .eq('home_id', sensor.home_id)
      .in('sensor_id', await getTempSensorIds(sensor.home_id))
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()

    if (recentTemp && recentTemp.value >= 78) {
      const alert = {
        home_id: sensor.home_id,
        sensor_id: sensor.id,
        severity: 'warning',
        title: 'AC unit may have failed',
        description: `The AC unit is drawing no power and indoor temperature is ${recentTemp.value}°F. This may indicate an AC failure.`,
      }
      await createAlert(alert)
      triggered.push(alert)
    }
  }

  // Rule 3: Door opened at night (10 PM - 6 AM)
  if (sensor.sensor_type === 'door' && reading.value === 1) {
    const hour = new Date(reading.recorded_at).getHours()
    if (hour >= 22 || hour < 6) {
      const alert = {
        home_id: sensor.home_id,
        sensor_id: sensor.id,
        severity: 'warning',
        title: 'Door opened during nighttime hours',
        description: `The ${sensor.name} was opened at ${new Date(reading.recorded_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}. This is outside normal hours.`,
      }
      await createAlert(alert)
      triggered.push(alert)
    }
  }

  // Rule 4: Fall detected (from FP2 or FP400 presence sensors)
  if (sensor.sensor_type === 'presence' && attributes) {
    const fallDetected = attributes.fall_detected === true ||
      attributes.fall === true ||
      attributes.event_type === 'fall'

    if (fallDetected) {
      const alert = {
        home_id: sensor.home_id,
        sensor_id: sensor.id,
        severity: 'critical',
        title: 'Possible fall detected',
        description: `A possible fall has been detected by the ${sensor.name} in the ${sensor.location}. Contact your loved one immediately.`,
      }
      await createAlert(alert)
      triggered.push(alert)
    }
  }

  // Rule 5: Water leak (if you add leak sensors later)
  if (sensor.sensor_type === 'leak' && reading.value === 1) {
    const alert = {
      home_id: sensor.home_id,
      sensor_id: sensor.id,
      severity: 'critical',
      title: 'Water leak detected',
      description: `The ${sensor.name} has detected water. Check the area immediately.`,
    }
    await createAlert(alert)
    triggered.push(alert)
  }

  return triggered
}

async function createAlert(alertData: AlertData) {
  // Check if a similar alert was created in the last 30 minutes (debounce)
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()

  const { data: recent } = await supabase
    .from('alerts')
    .select('id')
    .eq('home_id', alertData.home_id)
    .eq('title', alertData.title)
    .gte('created_at', thirtyMinAgo)
    .limit(1)

  if (recent && recent.length > 0) {
    console.log(`Alert debounced: ${alertData.title}`)
    return // Don't create duplicate alerts within 30 min
  }

  const { error } = await supabase
    .from('alerts')
    .insert({
      ...alertData,
      is_resolved: false,
      created_at: new Date().toISOString(),
    })

  if (error) {
    console.error('Failed to create alert:', error)
  } else {
    console.log(`Alert created: ${alertData.title}`)

    // Send email notifications to family members
    await notifyFamilyMembers(alertData)
  }
}

async function notifyFamilyMembers(alertData: AlertData) {
  // Get family members for this home
  const { data: members } = await supabase
    .from('home_members')
    .select('*, profiles(*)')
    .eq('home_id', alertData.home_id)

  if (!members || members.length === 0) return

  // Get home details for the email
  const { data: home } = await supabase
    .from('homes')
    .select('name, city')
    .eq('id', alertData.home_id)
    .single()

  const homeName = home?.name || 'Your monitored home'

  // Send email via Resend (if RESEND_API_KEY is configured)
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.log('RESEND_API_KEY not set — skipping email notifications')
    return
  }

  for (const member of members) {
    const email = member.profiles?.email
    if (!email || !member.notify_by_email) continue

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Proxia Care Alerts <alerts@proxiacare.com>',
          to: email,
          subject: `[${alertData.severity.toUpperCase()}] ${alertData.title} — ${homeName}`,
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
              <div style="background: ${alertData.severity === 'critical' ? '#F07C6B' : alertData.severity === 'warning' ? '#FFBC00' : '#5BBFB5'}; padding: 16px 20px; border-radius: 12px 12px 0 0;">
                <h2 style="color: white; margin: 0; font-size: 18px;">
                  ${alertData.severity === 'critical' ? '🚨' : alertData.severity === 'warning' ? '⚠️' : 'ℹ️'} ${alertData.title}
                </h2>
              </div>
              <div style="background: #FAF6F0; padding: 20px; border: 1px solid #D8EDEB; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="color: #1C2B29; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">
                  ${alertData.description}
                </p>
                <p style="color: #7A9694; font-size: 13px; margin: 0 0 16px 0;">
                  ${homeName} · ${home?.city || 'Phoenix, AZ'} · ${new Date().toLocaleString('en-US', { timeZone: 'America/Phoenix' })}
                </p>
                <a href="https://app.proxiacare.com/dashboard" style="display: inline-block; background: #5BBFB5; color: white; padding: 10px 24px; border-radius: 20px; text-decoration: none; font-weight: bold; font-size: 14px;">
                  View Dashboard →
                </a>
                <p style="color: #7A9694; font-size: 11px; margin: 16px 0 0 0;">
                  Proxia Care · For life-threatening emergencies, always dial 911.
                </p>
              </div>
            </div>
          `,
        }),
      })
      console.log(`Email sent to ${email}`)
    } catch (err) {
      console.error(`Failed to send email to ${email}:`, err)
    }
  }
}

async function getTempSensorIds(homeId: string): Promise<string[]> {
  const { data } = await supabase
    .from('sensors')
    .select('id')
    .eq('home_id', homeId)
    .eq('sensor_type', 'temp')

  return data?.map((s: { id: string }) => s.id) || []
}
