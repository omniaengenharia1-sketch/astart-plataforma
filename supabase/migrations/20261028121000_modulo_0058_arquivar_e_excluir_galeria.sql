-- 0058 — arquivar e excluir galeria.
--
-- "nao tem como eu apagar a galeria". É verdade, e é o mesmo caso da capa na
-- 0057: a coluna `arquivada_em` existe desde a 0034, os dois leitores a
-- respeitam (`galeria_por_token` recusa galeria arquivada, `galerias_do_cliente`
-- não a lista), e **nenhuma função a preenche**. Foi desenhada e nunca ligada.
--
-- "Apagar" aqui são duas coisas diferentes, e misturar as duas é como se perde
-- entrega de cliente:
--
--   ARQUIVAR  — some para o cliente, o link para de abrir, os arquivos ficam.
--               Reversível. É o que se quer em 95% dos casos: a entrega saiu do
--               ar porque acabou o combinado, não porque o material é lixo.
--
--   EXCLUIR   — as linhas somem e os arquivos saem do balde. Não tem volta,
--               e libera espaço de verdade. É o que se quer quando a galeria
--               foi criada errada, ou quando o cliente já pegou tudo e o
--               armazenamento está pesando.
--
-- Arquivar é da equipe. Excluir é da DIREÇÃO: apagar a captação de um cliente
-- por engano não tem desfazer, e quem assume isso é quem responde pela agência.

-- ---------------------------------------------------------------------------
-- Arquivar — reversível, e mata o link sem revogar nada
--
-- Não precisa mexer em `links_galeria`: `galeria_por_token` já recusa galeria
-- arquivada. Então desarquivar devolve o MESMO link ao ar, que é o que se
-- espera de uma gaveta. Revogar é outra decisão, e continua sendo outro botão.
-- ---------------------------------------------------------------------------
create or replace function public.arquivar_galeria(p_galeria uuid, p_arquivar boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_quando timestamptz;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para arquivar galeria.';
  end if;
  if not exists (select 1 from public.galerias g where g.id = p_galeria) then
    raise exception 'Galeria nao encontrada.';
  end if;

  v_quando := case when coalesce(p_arquivar, true) then now() else null end;
  update public.galerias set arquivada_em = v_quando where id = p_galeria;

  return jsonb_build_object('arquivadaEm', v_quando);
end;
$$;

revoke all on function public.arquivar_galeria(uuid, boolean) from public, anon;
grant execute on function public.arquivar_galeria(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Excluir — sem volta, e devolve os caminhos para quem apaga o arquivo
--
-- A função apaga as LINHAS e devolve os CAMINHOS. Quem tira do balde é o
-- navegador de quem clicou, logo depois, com o mesmo JWT — porque é ele que já
-- tem permissão no bucket, e porque uma função SQL não alcança o storage.
--
-- A ordem é essa de propósito: linha primeiro, arquivo depois. Ao contrário,
-- uma falha no meio deixaria a galeria apontando para arquivo que não existe —
-- miniatura quebrada na cara do cliente. Do jeito certo, uma falha no meio
-- deixa arquivo órfão no balde: desperdício, não defeito. Entre os dois, o
-- desperdício é o barato.
-- ---------------------------------------------------------------------------
create or replace function public.excluir_galeria(p_galeria uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caminhos text[];
  v_titulo   text;
  v_itens    int;
begin
  -- Direção, não equipe. Apagar a captação de um cliente não tem desfazer.
  if not public.usuario_admin() then
    raise exception
      'So a direcao exclui galeria. Para tirar do ar sem apagar, use arquivar — '
      'o link para de abrir e os arquivos ficam.';
  end if;

  select coalesce(g.titulo, s.titulo) into v_titulo
    from public.galerias g
    left join public.sessoes_captacao s on s.id = g.sessao_id
   where g.id = p_galeria;
  if not found then
    raise exception 'Galeria nao encontrada.';
  end if;

  select array_agg(c) , count(distinct i.id)
    into v_caminhos, v_itens
    from public.galeria_itens i
    cross join lateral unnest(array[i.caminho, i.miniatura_caminho, i.poster_caminho]) as c
   where i.galeria_id = p_galeria and c is not null;

  -- O cascade da 0022/0034 leva itens, links, favoritos e downloads junto.
  delete from public.galerias where id = p_galeria;

  return jsonb_build_object(
    'titulo', v_titulo,
    'itens', coalesce(v_itens, 0),
    'caminhos', coalesce(to_jsonb(v_caminhos), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.excluir_galeria(uuid) from public, anon;
grant execute on function public.excluir_galeria(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E a lista mostra a arquivada — para QUEM EDITA
--
-- O cliente continua sem ver: entrega arquivada saiu do ar, e aparecer apagada
-- no portal dele só geraria pergunta. Já a equipe precisa ver, senão arquivar
-- vira sumiço: a galeria desaparece da tela e não há mais como desarquivar.
-- ---------------------------------------------------------------------------
create or replace function public.galerias_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case when not public.usuario_ve_cliente(p_cliente) then null::jsonb else
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'titulo', coalesce(g.titulo, s.titulo),
        'sessaoId', s.id,
        'quando', s.data,
        'local', s.local,
        'provedor', g.provedor,
        'url', g.url,
        'permiteDownload', g.permite_download,
        'publicadaEm', g.publicada_em,
        'arquivadaEm', g.arquivada_em,
        'capa', (select i.miniatura_caminho from public.galeria_itens i
                  where i.id = g.capa_item_id),
        'capaItemId', g.capa_item_id,
        'fotos', (select count(*) from public.galeria_itens i
                   where i.galeria_id = g.id and i.tipo = 'foto' and i.pronto),
        'videos', (select count(*) from public.galeria_itens i
                    where i.galeria_id = g.id and i.tipo = 'video' and i.pronto),
        'bytes', coalesce((select sum(i.tamanho_bytes) from public.galeria_itens i
                            where i.galeria_id = g.id and i.pronto), 0),
        'favoritos', (select count(*) from public.galeria_favoritos f where f.galeria_id = g.id),
        'baixou', exists (select 1 from public.galeria_downloads d where d.galeria_id = g.id),
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'criadoEm', l.criado_em, 'acessos', l.acessos,
            'ultimoAcessoEm', l.ultimo_acesso_em))
          from public.links_galeria l
         where l.galeria_id = g.id and l.revogado_em is null), '[]'::jsonb))
        -- Arquivada vai para o fim: o que está no ar é o que se trabalha.
        order by (g.arquivada_em is not null), s.data desc)
      from public.galerias g
      join public.sessoes_captacao s on s.id = g.sessao_id
     where s.cliente_id = p_cliente
       and (g.arquivada_em is null or public.usuario_edita())), '[]'::jsonb)
  end;
$$;

revoke all on function public.galerias_do_cliente(uuid) from public, anon;
grant execute on function public.galerias_do_cliente(uuid) to authenticated, service_role;
