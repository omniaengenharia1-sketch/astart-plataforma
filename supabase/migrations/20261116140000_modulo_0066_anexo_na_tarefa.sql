-- 0066 — imagem e documento no cartao.
--
-- Pedido da dona: "queria que no card desse pra colocar imagem, documento".
--
-- Faz sentido: "fazer criativo" pede a referencia junto, e briefing sem o
-- arquivo vira troca de WhatsApp — que e exatamente o que este quadro existe
-- para tirar do WhatsApp.
--
-- A LICAO DA GALERIA, APLICADA DESDE O PRIMEIRO DIA
--
-- Duas semanas atras o balde das galerias acumulou 175 MB de arquivo orfao, e
-- a causa foi uma politica de leitura amarrada a existencia da linha:
--
--   galerias_le: usuario_ve_galeria(galeria_do_caminho(name))
--
-- Apagar a galeria apagava a linha PRIMEIRO; nesse instante os arquivos
-- ficavam invisiveis para todo mundo, e o Storage nao apaga o que nao acha.
-- Toda galeria apagada vazava 100% dos arquivos, sempre, e ninguem viu por
-- dois dias porque o contador reportava sucesso na ausencia de erro.
--
-- Aqui a politica ja nasce com o ramo do orfao: a equipe enxerga arquivo cujo
-- cartao nao existe mais, e por isso consegue limpar. Nao e defesa teorica —
-- e o mesmo bug, escrito antes de acontecer de novo.
--
-- E `apagar_tarefa` passa a DEVOLVER os caminhos, para o navegador tirar os
-- arquivos do balde. SQL nao alcanca o storage; quem apaga e quem tem o JWT.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tarefas', 'tarefas', false,
  209715200,   -- 200 MB: cabe PSD de criativo e PDF de contrato
  array[
    'image/jpeg','image/png','image/webp','image/avif','image/heic','image/gif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv','text/plain',
    'video/mp4','video/quicktime'
  ]
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- De qual tarefa e o caminho
--
-- Confere o formato ANTES de converter, como `galeria_do_caminho`: esta
-- funcao roda dentro da politica do balde, e um cast estourando num nome
-- torto nao derrubaria so aquele arquivo — derrubaria toda leitura do
-- storage, para todo mundo.
-- ---------------------------------------------------------------------------
create or replace function public.tarefa_do_caminho(p_caminho text)
returns uuid
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when split_part(coalesce(p_caminho, ''), '/', 1)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_caminho, '/', 1)::uuid
  end;
$$;

revoke all on function public.tarefa_do_caminho(text) from public, anon;
grant execute on function public.tarefa_do_caminho(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A tabela dos anexos
--
-- O nome original vive aqui, nao no balde: o arquivo no balde tem nome de
-- uuid para dois arquivos com o mesmo nome nao se atropelarem.
-- ---------------------------------------------------------------------------
create table if not exists public.tarefa_arquivos (
  id         uuid primary key default gen_random_uuid(),
  tarefa_id  uuid not null references public.tarefas(id) on delete cascade,
  nome       text not null,
  caminho    text not null unique,
  tipo       text,
  bytes      bigint,
  subido_por uuid references public.perfis(user_id) on delete set null,
  criado_em  timestamptz not null default now()
);

create index if not exists tarefa_arquivos_tarefa on public.tarefa_arquivos (tarefa_id);

alter table public.tarefa_arquivos enable row level security;

create policy tarefa_arquivos_le on public.tarefa_arquivos
  for select using (public.usuario_ve_tarefa(tarefa_id));
create policy tarefa_arquivos_escreve on public.tarefa_arquivos
  for all using (public.usuario_ve_tarefa(tarefa_id))
          with check (public.usuario_ve_tarefa(tarefa_id));

revoke all on table public.tarefa_arquivos from anon;

-- ---------------------------------------------------------------------------
-- O balde
--
-- Ler: quem ve o cartao. MAIS o ramo do orfao, que e a licao da galeria —
-- sem ele, apagar o cartao tornaria os arquivos invisiveis e portanto
-- impossiveis de apagar.
-- ---------------------------------------------------------------------------
-- O "existe?" PRECISA ser security definer. Esta e a parte fina.
--
-- A primeira versao escreveu o ramo do orfao com um `not exists` direto na
-- politica — e esse subselect roda sob o RLS de quem esta perguntando. Como as
-- tarefas sao propositalmente privadas (cada um ve as suas), para o Pedro a
-- linha da tarefa da Layana NAO EXISTE. "Tarefa que eu nao posso ver" ficava
-- identica a "tarefa que nao existe", e ele passava a enxergar o anexo dela.
--
-- O teste 37 pegou na primeira rodada.
--
-- A mesma forma e segura na politica das galerias (0063) porque `galerias` tem
-- `galerias_equipe_le: usuario_ativo()` — toda a equipe ve toda galeria, entao
-- ali "nao existe" e mesmo "nao existe". A diferenca nao esta na politica do
-- balde: esta em quem ve a tabela por tras dela.
create or replace function public.tarefa_existe(p_tarefa uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_tarefa is not null
     and exists (select 1 from public.tarefas where id = p_tarefa);
$$;

revoke all on function public.tarefa_existe(uuid) from public, anon;
grant execute on function public.tarefa_existe(uuid) to authenticated, service_role;

create policy tarefas_arquivo_le on storage.objects
for select
using (
  bucket_id = 'tarefas'
  and (
    public.usuario_ve_tarefa(public.tarefa_do_caminho(name))
    or (public.usuario_edita() and not public.tarefa_existe(public.tarefa_do_caminho(name)))
  )
);

create policy tarefas_arquivo_sobe on storage.objects
for insert
with check (
  bucket_id = 'tarefas'
  and public.usuario_ve_tarefa(public.tarefa_do_caminho(name))
);

create policy tarefas_arquivo_apaga on storage.objects
for delete
using (bucket_id = 'tarefas' and public.usuario_edita());

-- ---------------------------------------------------------------------------
-- Apagar a tarefa passa a devolver os caminhos
--
-- Antes devolvia void. Agora devolve a lista, para o navegador tirar os
-- arquivos do balde — a linha some por cascade, e sem esta lista os arquivos
-- ficariam exatamente como os 175 MB da galeria.
--
-- A ordem continua linha primeiro, arquivo depois, pelo mesmo motivo de la: ao
-- contrario, uma falha no meio deixaria o cartao apontando para arquivo que
-- nao existe. A diferenca e que agora a politica deixa ver o orfao, entao a
-- segunda metade funciona.
-- ---------------------------------------------------------------------------
drop function if exists public.apagar_tarefa(uuid);

create or replace function public.apagar_tarefa(p_tarefa uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caminhos text[];
begin
  if not exists (
    select 1 from public.tarefas
     where id = p_tarefa and (public.usuario_admin() or criado_por = auth.uid())
  ) then
    raise exception
      'So quem criou a tarefa (ou a direcao) pode apaga-la. Se ela nao e mais '
      'para fazer, mova para a coluna final.';
  end if;

  select array_agg(caminho) into v_caminhos
    from public.tarefa_arquivos where tarefa_id = p_tarefa;

  delete from public.tarefas where id = p_tarefa;

  return jsonb_build_object('caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb));
end;
$$;

revoke all on function public.apagar_tarefa(uuid) from public, anon;
grant execute on function public.apagar_tarefa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Registrar e tirar um anexo
-- ---------------------------------------------------------------------------
create or replace function public.registrar_arquivo_da_tarefa(
  p_tarefa  uuid,
  p_nome    text,
  p_caminho text,
  p_tipo    text default null,
  p_bytes   bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if not public.usuario_ve_tarefa(p_tarefa) then
    raise exception 'Esta tarefa nao e sua.';
  end if;
  -- O caminho tem de ser DESTA tarefa. Sem isto um anexo poderia apontar para
  -- a pasta de outro cartao e aparecer para quem nao deveria ve-lo.
  if public.tarefa_do_caminho(p_caminho) is distinct from p_tarefa then
    raise exception 'O arquivo precisa estar na pasta desta tarefa.';
  end if;

  insert into public.tarefa_arquivos (tarefa_id, nome, caminho, tipo, bytes, subido_por)
  values (p_tarefa, p_nome, p_caminho, p_tipo, p_bytes, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.tirar_arquivo_da_tarefa(p_arquivo uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_caminho text;
begin
  select a.caminho into v_caminho
    from public.tarefa_arquivos a
   where a.id = p_arquivo and public.usuario_ve_tarefa(a.tarefa_id);
  if v_caminho is null then
    raise exception 'Anexo nao encontrado.';
  end if;
  delete from public.tarefa_arquivos where id = p_arquivo;
  -- Devolve o caminho para o navegador tirar do balde. Mesma razao do apagar
  -- tarefa: SQL nao alcanca o storage.
  return v_caminho;
end;
$$;

revoke all on function public.registrar_arquivo_da_tarefa(uuid, text, text, text, bigint)
  from public, anon;
grant execute on function public.registrar_arquivo_da_tarefa(uuid, text, text, text, bigint)
  to authenticated, service_role;
revoke all on function public.tirar_arquivo_da_tarefa(uuid) from public, anon;
grant execute on function public.tirar_arquivo_da_tarefa(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E o quadro passa a trazer os anexos de cada cartao
-- ---------------------------------------------------------------------------
create or replace function public.quadro_de_tarefas(
  p_de  date default null,
  p_ate date default null
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ativo() then null::jsonb else
    jsonb_build_object(
      'colunas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'nome', c.nome, 'ordem', c.ordem, 'final', c.final)
                 order by c.ordem, c.criado_em)
          from public.tarefa_colunas c), '[]'::jsonb),
      'tarefas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id,
                 'titulo', t.titulo,
                 'detalhe', t.detalhe,
                 'colunaId', t.coluna_id,
                 'ordem', t.ordem,
                 'prazo', t.prazo,
                 'concluidoEm', t.concluido_em,
                 'responsavelId', t.responsavel_id,
                 'responsavel', pr.nome,
                 'criadoPor', t.criado_por,
                 'criadoPorNome', pc.nome,
                 'clienteId', t.cliente_id,
                 'cliente', cl.nome,
                 'mencionados', coalesce((
                   select jsonb_agg(jsonb_build_object('id', pm.user_id, 'nome', pm.nome)
                          order by pm.nome)
                     from public.tarefa_mencoes m
                     join public.perfis pm on pm.user_id = m.perfil_id
                    where m.tarefa_id = t.id), '[]'::jsonb),
                 -- O CAMINHO, nao a URL: balde privado, e quem assina e o
                 -- navegador na hora de abrir, com validade curta. URL
                 -- assinada dentro do quadro inteiro seria assinar dezenas de
                 -- arquivos que ninguem vai abrir.
                 'arquivos', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', a.id, 'nome', a.nome, 'caminho', a.caminho,
                            'tipo', a.tipo, 'bytes', a.bytes)
                          order by a.criado_em)
                     from public.tarefa_arquivos a
                    where a.tarefa_id = t.id), '[]'::jsonb))
                 order by t.ordem, t.criado_em)
          from public.tarefas t
          left join public.perfis   pr on pr.user_id = t.responsavel_id
          left join public.perfis   pc on pc.user_id = t.criado_por
          left join public.clientes cl on cl.id = t.cliente_id
         where (p_de  is null or t.prazo is null or t.prazo >= p_de)
           and (p_ate is null or t.prazo is null or t.prazo <= p_ate)), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.quadro_de_tarefas(date, date) from public, anon;
grant execute on function public.quadro_de_tarefas(date, date) to authenticated, service_role;
