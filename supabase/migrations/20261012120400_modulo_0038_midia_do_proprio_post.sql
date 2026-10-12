-- =============================================================================
-- Modulo — 0038: o cliente le a midia do proprio post
--
-- O bucket `midias-posts` nasceu na 0008 para o worker da Meta: so a equipe
-- ativa lia. Quando o Grid e o Calendario chegaram ao portal, a tela do cliente
-- passou a precisar da imagem — e um grid de retangulos vazios nao e um grid.
--
-- Mesma forma da 0035: o CAMINHO diz de quem e o arquivo. A convencao da 0008 e
-- {cliente_id}/{post_id}/{ordem}-{arquivo}, e quem escreve no bucket continua
-- sendo so a equipe (`usuario_edita`) — ninguem de fora escolhe sob qual pasta
-- o arquivo cai.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- O primeiro pedaco do caminho e o cliente.
--
-- Confere o formato ANTES do cast, como `galeria_do_caminho`: esta funcao roda
-- dentro da politica do bucket, e um nome de arquivo torto estourando aqui nao
-- derrubaria apenas aquele arquivo — derrubaria toda leitura do storage.
-- ---------------------------------------------------------------------------
create or replace function public.cliente_do_caminho_midia(p_caminho text)
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

-- ---------------------------------------------------------------------------
-- Quem pode ver a midia de um post deste cliente.
--
-- SECURITY DEFINER pelo mesmo motivo da 0035: a politica roda como quem pediu
-- o arquivo, e as duas funcoes que decidem ja sao definer. Caminho torto vira
-- `null`, e `usuario_ve_cliente(null)` e falso — nao estoura, nao libera.
-- ---------------------------------------------------------------------------
create or replace function public.usuario_ve_midia_do_post(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.usuario_ativo()
      or (
        public.usuario_ve_cliente(p_cliente)
        -- Modulo e portao aqui tambem: a midia aparece nas telas de Grid e
        -- Calendario, e sao elas que o contrato liga. Sem nenhuma das duas, o
        -- arquivo nao tem onde ser mostrado — e nao e lido.
        and (
          public.cliente_tem_modulo(p_cliente, 'grid')
          or public.cliente_tem_modulo(p_cliente, 'calendario')
        )
      );
$$;

revoke all on function public.cliente_do_caminho_midia(text)  from public, anon;
revoke all on function public.usuario_ve_midia_do_post(uuid)  from public, anon;
grant execute on function public.cliente_do_caminho_midia(text) to authenticated, service_role;
grant execute on function public.usuario_ve_midia_do_post(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A politica de leitura, agora com o cliente dentro. Escrita, atualizacao e
-- remocao continuam exatamente como a 0008 deixou: equipe que edita.
-- ---------------------------------------------------------------------------
drop policy if exists midias_posts_le on storage.objects;
create policy midias_posts_le on storage.objects
  for select to authenticated
  using (
    bucket_id = 'midias-posts'
    and public.usuario_ve_midia_do_post(public.cliente_do_caminho_midia(name))
  );
