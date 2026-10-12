-- =============================================================================
-- Modulo — 0035: o bucket das galerias
--
-- Privado. Nada de arquivo de cliente em URL publica adivinhavel — a foto da
-- campanha de um cliente nao pode cair no Google porque alguem acertou um id.
--
-- Quem le:
--   - a equipe ativa, direto;
--   - o cliente LOGADO, so dos arquivos da propria galeria (a politica traduz
--     o caminho em cliente);
--   - o visitante do link sem conta NAO le o bucket. Ele passa pela Edge
--     Function, que troca o token por uma URL assinada de vida curta.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'galerias',
  'galerias',
  false,
  -- 5 GiB: um video de captacao em 4K passa facil de 1 GB. Upload acima do
  -- limite do plano precisa ser retomavel (TUS), que e o que o front usa.
  5368709120,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/heic', 'image/tiff',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- O caminho é o dono: <galeria_id>/<orig|mini|poster>/<item_id>.<ext>
--
-- SECURITY DEFINER porque a politica roda como o visitante, e ele nao enxerga
-- galerias nem sessoes_captacao — a armadilha de RLS numero um deste projeto.
-- ---------------------------------------------------------------------------
create or replace function public.galeria_do_caminho(p_caminho text)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  -- Confere o formato ANTES de converter. Esta funcao roda dentro da politica
  -- do bucket: um nome de arquivo torto fazendo cast estourar nao derrubaria
  -- so aquele arquivo — derrubaria toda leitura do storage, para todo mundo.
  select case
    when split_part(coalesce(p_caminho, ''), '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_caminho, '/', 1)::uuid
  end;
$$;

create or replace function public.usuario_ve_galeria(p_galeria uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.galerias g
      join public.sessoes_captacao s on s.id = g.sessao_id
     where g.id = p_galeria
       and (
         public.usuario_ativo()
         or (s.cliente_id in (select public.clientes_do_usuario())
             and public.cliente_tem_modulo(s.cliente_id, 'galeria'))
       )
  );
$$;

revoke all on function public.galeria_do_caminho(text) from public, anon;
revoke all on function public.usuario_ve_galeria(uuid) from public, anon;
grant execute on function public.galeria_do_caminho(text) to authenticated, service_role;
grant execute on function public.usuario_ve_galeria(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Politicas do bucket
-- ---------------------------------------------------------------------------
drop policy if exists galerias_le on storage.objects;
create policy galerias_le on storage.objects
  for select to authenticated
  using (
    bucket_id = 'galerias'
    and public.usuario_ve_galeria(public.galeria_do_caminho(name))
  );

drop policy if exists galerias_sobe on storage.objects;
create policy galerias_sobe on storage.objects
  for insert to authenticated
  with check (bucket_id = 'galerias' and public.usuario_edita());

drop policy if exists galerias_atualiza on storage.objects;
create policy galerias_atualiza on storage.objects
  for update to authenticated
  using (bucket_id = 'galerias' and public.usuario_edita())
  with check (bucket_id = 'galerias' and public.usuario_edita());

drop policy if exists galerias_apaga on storage.objects;
create policy galerias_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'galerias' and public.usuario_edita());
