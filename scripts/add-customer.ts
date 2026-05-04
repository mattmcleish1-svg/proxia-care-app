/**
 * Proxia Care — Add New Customer
 *
 * Interactive script to create a new monitored home and family account.
 * Run with: npm run add-customer
 *
 * Prerequisites:
 *   - SUPABASE_SERVICE_ROLE_KEY in .env.local
 *   - Database schema already created
 */

import { createClient } from '@supabase/supabase-js'
import * as readline from 'readline'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

async function main() {
  console.log('\n🏠  Proxia Care — New Customer Setup\n')
  console.log('─'.repeat(50))

  // Gather info
  const familyName = await ask('Family name (e.g., "The Garcia Family"): ')
  const address = await ask('Home address: ')
  const city = await ask('City (e.g., "Gold Canyon"): ')
  const state = await ask('State (e.g., "AZ"): ') || 'AZ'

  console.log('')
  const contactEmail = await ask('Primary contact email: ')
  const contactName = await ask('Primary contact full name: ')
  const contactPhone = await ask('Contact phone (optional): ') || null
  const relationship = await ask('Relationship to senior (e.g., "daughter", "son"): ') || 'family'
  const tempPassword = await ask('Temporary password for their account: ')

  if (!familyName || !contactEmail || !tempPassword) {
    console.error('\n✗ Family name, email, and password are required.')
    process.exit(1)
  }

  console.log('\n─'.repeat(50))
  console.log('Setting up...\n')

  // 1. Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: contactEmail,
    password: tempPassword,
    email_confirm: true, // Skip email verification
  })

  if (authError) {
    if (authError.message.includes('already been registered')) {
      console.log(`ℹ  User ${contactEmail} already exists — looking up existing account...`)
      const { data: { users } } = await supabase.auth.admin.listUsers()
      const existingUser = users.find(u => u.email === contactEmail)
      if (!existingUser) {
        console.error('✗ Could not find existing user')
        process.exit(1)
      }
      (authData as any).user = existingUser
    } else {
      console.error('✗ Failed to create user:', authError.message)
      process.exit(1)
    }
  }

  const userId = authData!.user!.id
  console.log(`✓ User: ${contactEmail} (${userId})`)

  // 2. Create profile
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({
      id: userId,
      full_name: contactName,
      phone: contactPhone,
      role: 'family',
    })

  if (profileError) {
    console.error('✗ Failed to create profile:', profileError.message)
  } else {
    console.log(`✓ Profile: ${contactName}`)
  }

  // 3. Create home
  const { data: home, error: homeError } = await supabase
    .from('homes')
    .insert({
      name: familyName,
      address: address,
      city: city,
      state: state,
    })
    .select()
    .single()

  if (homeError) {
    console.error('✗ Failed to create home:', homeError.message)
    process.exit(1)
  }
  console.log(`✓ Home: ${familyName} (${home.id})`)

  // 4. Link user to home
  const { error: memberError } = await supabase
    .from('home_members')
    .insert({
      home_id: home.id,
      user_id: userId,
      relationship: relationship,
      role: 'family',
    })

  if (memberError) {
    console.error('✗ Failed to link user:', memberError.message)
  } else {
    console.log(`✓ Linked ${contactName} as ${relationship}`)
  }

  // 5. Ask about sensors
  console.log('\n─'.repeat(50))
  console.log('Sensor Setup\n')

  const sensorConfigs = await askAboutSensors()

  if (sensorConfigs.length > 0) {
    const sensors = sensorConfigs.map(s => ({
      ...s,
      home_id: home.id,
    }))

    const { data: createdSensors, error: sensorError } = await supabase
      .from('sensors')
      .insert(sensors)
      .select()

    if (sensorError) {
      console.error('✗ Failed to create sensors:', sensorError.message)
    } else {
      console.log(`✓ ${createdSensors.length} sensors registered`)
    }
  }

  // 6. Generate webhook secret for this home
  const webhookSecret = generateSecret()

  // 7. Print summary
  console.log('\n' + '═'.repeat(50))
  console.log('✅  Customer setup complete!\n')
  console.log(`Home:     ${familyName}`)
  console.log(`Address:  ${address}, ${city}, ${state}`)
  console.log(`Contact:  ${contactName} (${contactEmail})`)
  console.log(`Home ID:  ${home.id}`)
  console.log(`User ID:  ${userId}`)
  console.log('')
  console.log('Login credentials:')
  console.log(`  Email:    ${contactEmail}`)
  console.log(`  Password: ${tempPassword}`)
  console.log(`  URL:      https://app.proxiacare.com`)
  console.log('')
  console.log('Home Assistant webhook config:')
  console.log(`  URL:    https://app.proxiacare.com/api/webhook/sensor`)
  console.log(`  Secret: ${webhookSecret}`)
  console.log(`  Home ID: ${home.id}`)
  console.log('')
  console.log('Next steps:')
  console.log('  1. Share login credentials with the family')
  console.log('  2. Install sensors in the home')
  console.log('  3. Configure Home Assistant with the webhook URL above')
  console.log('  4. Verify data flows to the dashboard')
  console.log('═'.repeat(50) + '\n')

  rl.close()
}

async function askAboutSensors(): Promise<Array<{ name: string; sensor_type: string; location: string; external_id: string }>> {
  const sensors: Array<{ name: string; sensor_type: string; location: string; external_id: string }> = []

  const setupSensors = await ask('Set up default sensor kit? (y/n): ')

  if (setupSensors.toLowerCase() === 'y') {
    // Standard kit
    const defaultSensors = [
      { name: 'Bathroom Fall Sensor',    sensor_type: 'presence', location: 'bathroom',    external_id: 'binary_sensor.bathroom_presence' },
      { name: 'Living Room Fall Sensor', sensor_type: 'presence', location: 'living_room', external_id: 'binary_sensor.living_room_presence' },
      { name: 'Kitchen Motion',          sensor_type: 'motion',   location: 'kitchen',     external_id: 'binary_sensor.kitchen_motion' },
      { name: 'Bedroom Motion',          sensor_type: 'motion',   location: 'bedroom',     external_id: 'binary_sensor.bedroom_motion' },
      { name: 'Front Door',             sensor_type: 'door',     location: 'front_door',  external_id: 'binary_sensor.front_door' },
      { name: 'Living Room Temperature', sensor_type: 'temp',     location: 'living_room', external_id: 'sensor.living_room_temperature' },
      { name: 'Bathroom Temperature',    sensor_type: 'temp',     location: 'bathroom',    external_id: 'sensor.bathroom_temperature' },
      { name: 'AC Unit',                sensor_type: 'plug',     location: 'ac_unit',     external_id: 'sensor.ac_power' },
    ]

    console.log('\nDefault sensor kit:')
    defaultSensors.forEach(s => console.log(`  • ${s.name} (${s.location})`))
    console.log('')

    sensors.push(...defaultSensors)

    // Ask about optional add-ons
    const addSleep = await ask('Add sleep sensor? (y/n): ')
    if (addSleep.toLowerCase() === 'y') {
      sensors.push({
        name: 'Bedroom Sleep Sensor',
        sensor_type: 'sleep',
        location: 'bedroom',
        external_id: 'sensor.withings_sleep',
      })
    }

    const addLeak = await ask('Add water leak sensors? (y/n): ')
    if (addLeak.toLowerCase() === 'y') {
      sensors.push(
        { name: 'Kitchen Leak Sensor',   sensor_type: 'leak', location: 'kitchen',  external_id: 'binary_sensor.kitchen_leak' },
        { name: 'Bathroom Leak Sensor',  sensor_type: 'leak', location: 'bathroom', external_id: 'binary_sensor.bathroom_leak' },
      )
    }
  } else {
    console.log('Skipping sensor setup — you can add sensors later via Supabase.\n')
  }

  return sensors
}

function generateSecret(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'whsec_'
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

main().catch((err) => {
  console.error('\n✗ Unexpected error:', err)
  process.exit(1)
})
