/// <reference types="vite/client" />

// As duas variaveis que a plataforma le. Ausentes = modo exemplo.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
