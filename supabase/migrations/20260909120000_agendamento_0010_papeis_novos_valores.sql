-- =============================================================================
-- 0010: novos valores de papel_perfil
--
-- Migration separada de proposito: no Postgres, um valor recem-adicionado a um
-- enum nao pode ser usado na mesma transacao que o criou. O uso desses valores
-- (backfill, constraint, funcoes de RLS) fica na 0011.
-- =============================================================================

alter type public.papel_perfil add value if not exists 'operacao';
alter type public.papel_perfil add value if not exists 'financeiro';
