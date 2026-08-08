import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  ?? 'https://aowhhlaqnhtrzusqfmte.supabase.co';
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? 'sb_publishable_blHURQe4y2kdqLllzVYuCw_vyYAc1zf';

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Supabase nao configurado no frontend');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: true,
    persistSession: true,
    storageKey: 'ponto-facial-auth',
  },
});
