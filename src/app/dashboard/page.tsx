import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  // Get current user
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  // Get user's home
  const { data: membership } = await supabase
    .from('home_members')
    .select('home_id, relationship')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="bg-white rounded-2xl border border-[#D8EDEB] p-12">
          <p className="text-4xl mb-4">🏠</p>
          <h2 className="font-serif text-2xl font-bold text-[#1C2B29] mb-3">No Home Connected</h2>
          <p className="text-[#3D5552]">Your account isn&apos;t linked to a monitored home yet. Run the seed script or contact support.</p>
        </div>
      </div>
    )
  }

  // Get home details
  const { data: home } = await supabase
    .from('homes')
    .select('*')
    .eq('id', membership.home_id)
    .single()

  // Get all sensors for this home
  const { data: sensors } = await supabase
    .from('sensors')
    .select('*')
    .eq('home_id', membership.home_id)

  const sensorIds = sensors?.map((s: { id: string }) => s.id) || []

  // Get latest temperature readings
  const { data: tempReadings } = await supabase
    .from('sensor_readings')
    .select('*, sensors!inner(name, sensor_type, location)')
    .in('sensor_id', sensorIds)
    .eq('sensors.sensor_type', 'temp')
    .order('recorded_at', { ascending: false })
    .limit(2)

  // Get latest AC reading
  const acSensor = sensors?.find((s: { sensor_type: string }) => s.sensor_type === 'plug')
  let acReading = null
  if (acSensor) {
    const { data } = await supabase
      .from('sensor_readings')
      .select('*')
      .eq('sensor_id', acSensor.id)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single()
    acReading = data
  }

  // Get last motion event
  const { data: lastMotion } = await supabase
    .from('sensor_readings')
    .select('*, sensors!inner(name, sensor_type, location)')
    .in('sensor_id', sensorIds)
    .in('sensors.sensor_type', ['motion', 'presence'])
    .eq('value', 1)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single()

  // Get latest sleep summary
  const { data: lastSleep } = await supabase
    .from('sleep_summaries')
    .select('*')
    .eq('home_id', membership.home_id)
    .order('date', { ascending: false })
    .limit(1)
    .single()

  // Get recent alerts
  const { data: recentAlerts } = await supabase
    .from('alerts')
    .select('*')
    .eq('home_id', membership.home_id)
    .order('created_at', { ascending: false })
    .limit(5)

  // Get active (unresolved) alerts count
  const activeAlerts = recentAlerts?.filter((a: { is_resolved: boolean }) => !a.is_resolved) || []

  // Get 24h of motion data for activity timeline
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: motionData } = await supabase
    .from('sensor_readings')
    .select('*, sensors!inner(name, sensor_type, location)')
    .in('sensor_id', sensorIds)
    .in('sensors.sensor_type', ['motion'])
    .gte('recorded_at', twentyFourHoursAgo)
    .order('recorded_at', { ascending: true })

  // Get 24h of temperature data for chart
  const { data: tempHistory } = await supabase
    .from('sensor_readings')
    .select('*, sensors!inner(name, sensor_type, location)')
    .in('sensor_id', sensorIds)
    .eq('sensors.sensor_type', 'temp')
    .gte('recorded_at', twentyFourHoursAgo)
    .order('recorded_at', { ascending: true })

  // Get 7 days of sleep data
  const { data: sleepHistory } = await supabase
    .from('sleep_summaries')
    .select('*')
    .eq('home_id', membership.home_id)
    .order('date', { ascending: true })
    .limit(7)

  // ── Process data for display ──

  // Current temp
  const currentTemp = tempReadings?.[0]?.value ?? null
  const tempColor = currentTemp === null
    ? 'text-[#7A9694]'
    : currentTemp > 82
      ? 'text-red-500'
      : currentTemp > 78
        ? 'text-amber-500'
        : 'text-emerald-500'

  // AC status
  const acOn = acReading?.value > 0
  const acWatts = acReading?.value ?? 0

  // Last motion
  const lastMotionRoom = lastMotion?.sensors?.location?.replace('_', ' ') ?? 'Unknown'
  const lastMotionTime = lastMotion?.recorded_at
    ? timeAgo(new Date(lastMotion.recorded_at))
    : 'No data'

  // Last activity (most recent of any sensor)
  const { data: lastAnyReading } = await supabase
    .from('sensor_readings')
    .select('recorded_at')
    .in('sensor_id', sensorIds)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .single()
  const lastActivity = lastAnyReading?.recorded_at
    ? timeAgo(new Date(lastAnyReading.recorded_at))
    : 'No data'

  // Activity timeline: bucket motion events by hour
  const activityByHour: Record<number, Record<string, number>> = {}
  for (let h = 0; h < 24; h++) activityByHour[h] = {}
  motionData?.forEach((r: { recorded_at: string; sensors: { location: string } }) => {
    const hour = new Date(r.recorded_at).getHours()
    const room = r.sensors.location.replace('_', ' ')
    activityByHour[hour][room] = (activityByHour[hour][room] || 0) + 1
  })

  // Temperature timeline
  const tempByHour: Record<number, { sum: number; count: number }> = {}
  tempHistory?.forEach((r: { recorded_at: string; value: number }) => {
    const hour = new Date(r.recorded_at).getHours()
    if (!tempByHour[hour]) tempByHour[hour] = { sum: 0, count: 0 }
    tempByHour[hour].sum += r.value
    tempByHour[hour].count++
  })

  const roomColors: Record<string, string> = {
    'kitchen': '#F07C6B',
    'living room': '#5BBFB5',
    'bathroom': '#3A9E94',
    'bedroom': '#1E7A72',
    'front door': '#FFBC00',
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* ── Status Banner ── */}
      <div className={`rounded-xl px-5 py-3 mb-6 flex items-center gap-3 ${
        activeAlerts.length > 0
          ? 'bg-[#FEF0ED] border border-[#F07C6B]/30'
          : 'bg-[#EAF8F6] border border-[#5BBFB5]/30'
      }`}>
        <span className="text-xl">{activeAlerts.length > 0 ? '⚠️' : '✅'}</span>
        <div>
          <p className={`font-bold text-sm ${activeAlerts.length > 0 ? 'text-[#D45F4D]' : 'text-[#1E7A72]'}`}>
            {activeAlerts.length > 0
              ? `${activeAlerts.length} Active Alert${activeAlerts.length > 1 ? 's' : ''}`
              : 'All Quiet'}
          </p>
          <p className="text-xs text-[#7A9694]">
            {activeAlerts.length > 0
              ? 'Check alerts below for details'
              : 'No alerts in the last 24 hours'}
          </p>
        </div>
      </div>

      {/* ── Home Header ── */}
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-bold text-[#1C2B29]">{home?.name || 'Your Home'}</h1>
        <p className="text-sm text-[#7A9694]">
          {home?.city}{home?.state ? `, ${home.state}` : ''} · Last activity: {lastActivity}
        </p>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">

        {/* Indoor Temp */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 hover:border-[#8DDBD4] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#7A9694] uppercase tracking-wide">Indoor Temp</span>
            <span className="text-lg">🌡️</span>
          </div>
          <p className={`text-3xl font-bold ${tempColor}`}>
            {currentTemp !== null ? `${currentTemp}°F` : '—'}
          </p>
          <p className="text-xs text-[#7A9694] mt-1">
            {currentTemp !== null
              ? currentTemp <= 78 ? 'Comfortable range' : currentTemp <= 82 ? 'Getting warm' : 'Too hot — check AC'
              : 'No sensor data'}
          </p>
        </div>

        {/* AC Status */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 hover:border-[#8DDBD4] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#7A9694] uppercase tracking-wide">AC Status</span>
            <span className="text-lg">❄️</span>
          </div>
          <p className={`text-3xl font-bold ${acOn ? 'text-emerald-500' : 'text-[#7A9694]'}`}>
            {acOn ? 'On' : 'Off'}
          </p>
          <p className="text-xs text-[#7A9694] mt-1">
            {acOn ? `Drawing ${acWatts}W` : 'No power draw'}
          </p>
        </div>

        {/* Last Seen */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 hover:border-[#8DDBD4] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#7A9694] uppercase tracking-wide">Last Seen</span>
            <span className="text-lg">👣</span>
          </div>
          <p className="text-xl font-bold text-[#1C2B29] capitalize">{lastMotionRoom}</p>
          <p className="text-xs text-[#7A9694] mt-1">{lastMotionTime}</p>
        </div>

        {/* Sleep Last Night */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 hover:border-[#8DDBD4] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-[#7A9694] uppercase tracking-wide">Sleep Last Night</span>
            <span className="text-lg">😴</span>
          </div>
          <p className="text-3xl font-bold text-[#1C2B29]">
            {lastSleep?.duration_hours ? `${lastSleep.duration_hours}h` : '—'}
          </p>
          <p className="text-xs text-[#7A9694] mt-1">
            {lastSleep?.quality_score ? `Quality: ${lastSleep.quality_score}/100` : 'No sleep data'}
          </p>
        </div>
      </div>

      {/* ── Activity Timeline ── */}
      <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 mb-6">
        <h2 className="font-bold text-sm text-[#1C2B29] mb-1">24-Hour Activity</h2>
        <p className="text-xs text-[#7A9694] mb-4">Motion events by room over the last 24 hours</p>

        <div className="flex items-end gap-[3px] h-32">
          {Array.from({ length: 24 }, (_, h) => {
            const rooms = activityByHour[h] || {}
            const total = Object.values(rooms).reduce((a: number, b: number) => a + b, 0)
            const maxEvents = 8
            const heightPct = Math.min(total / maxEvents, 1) * 100

            return (
              <div key={h} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full relative" style={{ height: '100px' }}>
                  <div
                    className="absolute bottom-0 w-full rounded-t-sm transition-all"
                    style={{
                      height: `${heightPct}%`,
                      background: total > 0
                        ? Object.keys(rooms).length > 0
                          ? roomColors[Object.keys(rooms)[0]] || '#5BBFB5'
                          : '#5BBFB5'
                        : '#EAF8F6',
                      minHeight: total > 0 ? '4px' : '2px',
                      opacity: total > 0 ? 1 : 0.3,
                    }}
                  />
                </div>
                <span className="text-[9px] text-[#7A9694]">
                  {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex gap-4 mt-3 flex-wrap">
          {Object.entries(roomColors).map(([room, color]) => (
            <div key={room} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
              <span className="text-[10px] text-[#7A9694] capitalize">{room}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* ── Temperature Trend ── */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5">
          <h2 className="font-bold text-sm text-[#1C2B29] mb-1">Temperature Trend</h2>
          <p className="text-xs text-[#7A9694] mb-4">Indoor temperature over the last 24 hours</p>

          <div className="flex items-end gap-[2px] h-28">
            {Array.from({ length: 24 }, (_, h) => {
              const data = tempByHour[h]
              const avg = data ? data.sum / data.count : null
              const minTemp = 68
              const maxTemp = 82
              const heightPct = avg !== null
                ? Math.max(0, Math.min(((avg - minTemp) / (maxTemp - minTemp)) * 100, 100))
                : 0

              return (
                <div key={h} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full relative" style={{ height: '80px' }}>
                    <div
                      className="absolute bottom-0 w-full rounded-t-sm"
                      style={{
                        height: `${heightPct}%`,
                        background: avg !== null
                          ? avg > 82 ? '#ef4444' : avg > 78 ? '#f59e0b' : '#22c55e'
                          : '#EAF8F6',
                        minHeight: avg !== null ? '4px' : '2px',
                        opacity: avg !== null ? 0.8 : 0.2,
                      }}
                    />
                  </div>
                  {h % 4 === 0 && (
                    <span className="text-[9px] text-[#7A9694]">
                      {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div className="flex justify-between mt-2 text-[10px] text-[#7A9694]">
            <span>68°F</span>
            <span className="text-amber-500">78°F</span>
            <span className="text-red-500">82°F+</span>
          </div>
        </div>

        {/* ── Sleep Summary ── */}
        <div className="bg-white rounded-xl border border-[#D8EDEB] p-5">
          <h2 className="font-bold text-sm text-[#1C2B29] mb-1">Sleep This Week</h2>
          <p className="text-xs text-[#7A9694] mb-4">Nightly duration and quality score</p>

          <div className="flex items-end gap-2 h-28 mb-3">
            {sleepHistory?.map((s: { date: string; duration_hours: number; quality_score: number }, i: number) => {
              const maxH = 10
              const heightPct = (s.duration_hours / maxH) * 100
              const dayLabel = new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })

              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-[#3D5552]">{s.duration_hours}h</span>
                  <div className="w-full relative" style={{ height: '60px' }}>
                    <div
                      className="absolute bottom-0 w-full rounded-t-md"
                      style={{
                        height: `${heightPct}%`,
                        background: s.quality_score >= 80 ? '#5BBFB5' : s.quality_score >= 70 ? '#FFBC00' : '#F07C6B',
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-[#7A9694]">{dayLabel}</span>
                </div>
              )
            })}
          </div>

          <div className="flex gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#5BBFB5]" />
              <span className="text-[10px] text-[#7A9694]">Good (80+)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FFBC00]" />
              <span className="text-[10px] text-[#7A9694]">Fair (70-79)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-[#F07C6B]" />
              <span className="text-[10px] text-[#7A9694]">Poor (&lt;70)</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Recent Alerts ── */}
      <div className="bg-white rounded-xl border border-[#D8EDEB] p-5 mb-6">
        <h2 className="font-bold text-sm text-[#1C2B29] mb-1">Recent Alerts</h2>
        <p className="text-xs text-[#7A9694] mb-4">Activity from the past 7 days</p>

        {recentAlerts && recentAlerts.length > 0 ? (
          <div className="flex flex-col gap-3">
            {recentAlerts.map((alert: { id: string; severity: string; title: string; description: string; created_at: string; is_resolved: boolean }) => (
              <div
                key={alert.id}
                className={`flex items-start gap-3 p-3 rounded-lg border ${
                  alert.severity === 'warning'
                    ? 'bg-[#FEF0ED] border-[#F07C6B]/20'
                    : 'bg-[#EAF8F6] border-[#5BBFB5]/20'
                }`}
              >
                <span className="text-lg mt-0.5">
                  {alert.severity === 'warning' ? '⚠️' : 'ℹ️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-bold text-sm text-[#1C2B29]">{alert.title}</p>
                    {alert.is_resolved && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EAF8F6] text-[#1E7A72] border border-[#5BBFB5]/30">
                        Resolved
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[#3D5552] mb-1">{alert.description}</p>
                  <p className="text-[10px] text-[#7A9694]">
                    {new Date(alert.created_at).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#7A9694] text-center py-6">No alerts this week — everything is quiet.</p>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-xs text-[#7A9694] py-4">
        Proxia Care · {home?.city}{home?.state ? `, ${home.state}` : ''} · Data updates in real-time
      </p>
    </div>
  )
}

// ── Utility ──

function timeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}
