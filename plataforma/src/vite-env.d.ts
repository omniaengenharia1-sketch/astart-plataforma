/// <reference types="vite/client" />

// O que a plataforma le do ambiente. Sem URL ou sem chave = modo exemplo.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** Formato novo (`sb_publishable_...`). Preferida. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Formato antigo (JWT `eyJ...`). Ainda aceita, para projetos de antes. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_PREVIA?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
