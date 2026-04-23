import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="font-heading text-3xl font-bold text-teal-deep mb-3">
        Welcome to Proxia Care
      </h1>
      <p className="text-teal-dark text-base">
        Signed in as{' '}
        <span className="font-semibold text-teal-deep">{user?.email}</span>
      </p>
    </div>
  )
}
