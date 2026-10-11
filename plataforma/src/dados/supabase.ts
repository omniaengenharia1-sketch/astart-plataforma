import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * O cliente so existe quando as duas variaveis estao configuradas. Sem elas a
 * plataforma roda com dados de exemplo, e diz isso na tela — em vez de quebrar
 * com "failed to fetch" e deixar a pessoa adivinhando.
 */
const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
const chave = import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined;

export const ligado = Boolean(url && chave);

export const sb: SupabaseClient | null = ligado
  ? createClient(url as string, chave as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
