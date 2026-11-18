-- 0074 — a Página do Facebook passa a ser CONECTÁVEL.
--
-- A dona: "conectei a astart mas la so da a opcao de conectar no insta".
--
-- O adaptador da Página existe desde a 0072, com nove testes, e estava
-- INALCANÇÁVEL: não havia caminho na plataforma para ligar uma Página a um
-- cliente. Eu construí o motor e esqueci a porta — e nenhum teste pegou,
-- porque todos criavam a conta direto na tabela, que é o único jeito que
-- ninguém usa.
--
-- Ao abrir a porta, dois defeitos apareceram embaixo dela. Os dois são deste
-- arquivo; o da tela está no mesmo commit.
--
-- ===========================================================================
-- 1. `page_id` ÚNICO NO MUNDO IMPEDE A PÁGINA E O INSTAGRAM DELA
-- ===========================================================================
--
-- Uma conta de Instagram guarda o `page_id` da Página a que está vinculada —
-- é por ele que a Meta alcança a conta. Então a Página e o Instagram dela
-- carregam o MESMO `page_id`, e o índice único global recusava a segunda.
--
-- Conectar os dois destinos do mesmo cliente era impossível por construção, e
-- o erro que apareceria seria "duplicate key", que não fala de nada.
--
-- O único que fica é por plataforma: o que não pode é a MESMA Página ser
-- ligada duas vezes COMO PÁGINA. O `page_id` numa linha de Instagram é um
-- vínculo, não uma identidade.
--
-- ===========================================================================
-- 2. A BUSCA DE DUPLICATA CASAVA ENTRE PLATAFORMAS — E ISSO RENOMEAVA A CONTA
-- ===========================================================================
--
-- A `salvar_conta_social` procurava assim:
--
--   where (p_ig_user_id is not null and c.ig_user_id = p_ig_user_id)
--      or (p_page_id    is not null and c.page_id    = p_page_id)
--
-- Com o Instagram já conectado, ligar a Página entrava pelo segundo `or`,
-- achava a linha DO INSTAGRAM e caía no `update`. Resultado: o destino do
-- Facebook nunca nascia, e a conta de Instagram passava a se chamar pelo nome
-- da Página. Silencioso, e na conta de um cliente.
--
-- Agora a busca é por plataforma, e cada uma pela sua identidade.
-- ---------------------------------------------------------------------------

-- O índice único de `page_id` passa a valer só para a Página COMO DESTINO.
drop index if exists public.contas_sociais_page_id_key;

create unique index if not exists contas_sociais_page_id_key
  on public.contas_sociais (page_id)
  where page_id is not null and plataforma = 'facebook';

comment on index public.contas_sociais_page_id_key is
  'Uma Pagina so se liga uma vez COMO PAGINA. O mesmo page_id aparece tambem '
  'na linha do Instagram vinculado a ela, onde e vinculo e nao identidade.';

create or replace function public.salvar_conta_social(
  p_cliente     uuid,
  p_plataforma  public.plataforma_social,
  p_nome        text,
  p_ig_user_id  text default null,
  p_page_id     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.clientes c where c.id = p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'A conta precisa de um nome para aparecer na tela.';
  end if;

  -- O CHECK da tabela já cobra isto, e dizer antes é mais gentil que o erro do
  -- Postgres para quem está olhando a tela.
  if p_plataforma = 'instagram' and nullif(btrim(coalesce(p_ig_user_id, '')), '') is null then
    raise exception 'Conta de Instagram precisa do ig_user_id.';
  end if;
  if p_plataforma = 'facebook' and nullif(btrim(coalesce(p_page_id, '')), '') is null then
    raise exception 'Pagina do Facebook precisa do page_id.';
  end if;

  -- A BUSCA É POR PLATAFORMA, e cada uma pela identidade dela.
  --
  -- Antes um `or` solto casava o `page_id` da Pagina com o `page_id` guardado
  -- na linha do Instagram, e o `update` abaixo renomeava a conta errada. O
  -- `page_id` numa linha de Instagram e vinculo, nao identidade: so a linha
  -- de Facebook e identificada por ele.
  select c.id into v_id
    from public.contas_sociais c
   where c.plataforma = p_plataforma
     and case p_plataforma
           when 'instagram' then c.ig_user_id = p_ig_user_id
           when 'facebook'  then c.page_id    = p_page_id
         end
   limit 1;

  if v_id is not null then
    -- Conta que já existe pode estar em OUTRO cliente: trocar de cliente por
    -- engano moveria a publicação de lugar. Recusa alto.
    if exists (select 1 from public.contas_sociais c where c.id = v_id and c.cliente_id <> p_cliente) then
      raise exception
        'Esta conta da Meta ja esta ligada a outro cliente. '
        'Desligue lá antes de ligar aqui, para nao publicar no lugar errado.';
    end if;

    update public.contas_sociais
       set nome_exibicao = btrim(p_nome),
           ig_user_id    = coalesce(p_ig_user_id, ig_user_id),
           page_id       = coalesce(p_page_id, page_id),
           ativo         = true,
           atualizado_em = now()
     where id = v_id;

    return jsonb_build_object('id', v_id, 'novo', false, 'nome', btrim(p_nome));
  end if;

  insert into public.contas_sociais (cliente_id, plataforma, nome_exibicao, ig_user_id, page_id)
  values (p_cliente, p_plataforma, btrim(p_nome),
          nullif(btrim(coalesce(p_ig_user_id, '')), ''),
          nullif(btrim(coalesce(p_page_id, '')), ''))
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'novo', true, 'nome', btrim(p_nome));
end;
$$;

revoke all on function public.salvar_conta_social(
  uuid, public.plataforma_social, text, text, text) from public, anon;
grant execute on function public.salvar_conta_social(
  uuid, public.plataforma_social, text, text, text) to service_role;
