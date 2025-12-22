import { createClient } from '@supabase/supabase-js'

export const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // console.log('🔍 DEBUG - Variables de entorno:');
  // console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅ PRESENTE' : '❌ FALTANTE');
  // console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseKey ? '✅ PRESENTE' : '❌ FALTANTE');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('❌ Variables de entorno de Supabase faltantes');
  }

  return createClient(supabaseUrl, supabaseKey);
}
