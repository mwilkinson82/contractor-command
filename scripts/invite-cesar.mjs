import { createClient } from '@supabase/supabase-js'
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const { data, error } = await s.auth.admin.inviteUserByEmail('cbarbosa@nulifepower.com', {
  data: { source: 'manual_manus_purchase_recovery', invited_at: new Date().toISOString() },
  redirectTo: 'https://app.alpcontractorcircle.com/welcome',
})
console.log(error ? `ERROR: ${error.message}` : `OK: invited ${data.user?.email} (id=${data.user?.id})`)
