import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * O cliente so existe quando as duas variaveis estao configuradas. Sem elas a
 * plataforma roda com dados de exemplo, e diz isso na tela — em vez de quebrar
 * com "failed to fetch" e deixar a pessoa adivinhando.
 */
const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;

/**
 * A chave publica do projeto. O Supabase trocou o formato: a `anon` antiga era
 * um JWT (`eyJ...`) e a nova e uma publishable (`sb_publishable_...`). As duas
 * sao publicas por desenho — elas vao dentro do bundle, qualquer pessoa le do
 * navegador — e quem decide o que cada uma alcanca e o RLS, dentro do banco.
 *
 * Aceitamos os dois nomes de variavel porque projetos novos nem mostram mais a
 * `anon`, e projetos antigos ainda usam ela. Cair em modo exemplo por causa do
 * nome da variavel seria o tipo de erro que custa uma tarde.
 */
const chave =
  (import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined) ??
  (import.meta.env['VITE_SUPABASE_ANON_KEY'] as string | undefined);

export const ligado = Boolean(url && chave);

export const sb: SupabaseClient | null = ligado
  ? createClient(url as string, chave as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;
