-- 0057 — a galeria ganha capa escolhida, e o link encolhe.
--
-- Duas queixas da dona, no mesmo dia, sobre a mesma tela:
--
--   "consegue deixar essa area mais bonita? colocar uma capa (que eu possa
--    selecionar das fotos do cliente)"
--
--   "esse link da entrega ta tao grande e feio"
--
-- As duas são sobre a entrega chegar no cliente parecendo trabalho de agência.
-- A galeria é o que substitui o Pixieset, e o Pixieset entrega uma capa grande
-- com o nome em cima e um endereço que cabe numa mensagem. O que a gente
-- entregava era uma grade de cartões e 102 caracteres de hexadecimal.
--
-- ---------------------------------------------------------------------------
-- 1. A CAPA
--
-- A coluna `capa_item_id` existe desde a 0034 e nunca foi usada por ninguém: a
-- `registrar_item_galeria` põe a primeira foto lá e acabou. Não havia como
-- trocar, e nenhuma tela lia. Esta migration fecha o circuito — a função de
-- trocar, e a capa saindo nas duas leituras do álbum.
--
-- ---------------------------------------------------------------------------
-- 2. O LINK
--
-- Hoje: `encode(gen_random_bytes(32), 'hex')` — 64 caracteres, 256 bits.
--
--   /g/cda055ce12840f4f780862a249b6fb5a124970d2a31c03783edc1b07d7333519
--
-- 256 bits é segredo para guardar chave de banco, não para um link que vai por
-- WhatsApp. Passa a ser o nome da galeria mais 12 bytes em base64url:
--
--   /g/confraria-2309-Qk9mX2pL4nR8wZtA
--
-- São 96 bits de segredo. Para chutar um, com um palpite por nanossegundo, o
-- universo acaba primeiro. O modelo de segurança não muda em nada: o link
-- continua sendo a chave, continua guardado só como hash, e continua morrendo
-- quando revogado.
--
-- O que muda é que ele passa a DIZER o que é. Link que chega no cliente sem
-- nome nenhum parece golpe — e esse é um custo real que ninguém mede.
--
-- Os links antigos continuam valendo. A busca é por hash do que chegar, e o
-- hash não sabe o formato do que foi digerido. Nenhuma linha precisa migrar.

-- ---------------------------------------------------------------------------
-- A capa, escolhida a dedo
-- ---------------------------------------------------------------------------
create or replace function public.definir_capa_galeria(p_galeria uuid, p_item uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.galeria_itens%rowtype;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para trocar a capa da galeria.';
  end if;

  if not exists (select 1 from public.galerias g where g.id = p_galeria) then
    raise exception 'Galeria nao encontrada.';
  end if;

  -- `null` tira a capa e volta ao comportamento da 0034 (a primeira foto).
  if p_item is null then
    update public.galerias set capa_item_id = null where id = p_galeria;
    return jsonb_build_object('capaItemId', null);
  end if;

  select * into v_item from public.galeria_itens i where i.id = p_item;
  if not found then
    raise exception 'Esta foto nao existe mais. Recarregue a galeria.';
  end if;

  -- O item tem de ser DESTA galeria. Sem isto, a capa de uma entrega poderia
  -- apontar para a foto de outro cliente — e o caminho assinado sairia junto.
  if v_item.galeria_id is distinct from p_galeria then
    raise exception 'Esta foto e de outra galeria.';
  end if;

  if v_item.tipo <> 'foto' then
    raise exception 'A capa tem de ser uma foto. Video nao vira capa parado.';
  end if;

  if not v_item.pronto then
    raise exception 'Esta foto ainda esta subindo. Espere terminar para usar de capa.';
  end if;

  update public.galerias set capa_item_id = p_item where id = p_galeria;
  return jsonb_build_object('capaItemId', p_item);
end;
$$;

revoke all on function public.definir_capa_galeria(uuid, uuid) from public, anon;
grant execute on function public.definir_capa_galeria(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- O link curto
-- ---------------------------------------------------------------------------
create or replace function public.criar_link_galeria(p_galeria uuid)
returns table (link_id uuid, token text)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_token  text;
  v_id     uuid;
  v_nome   text;
  v_segredo text;
begin
  if not public.usuario_edita() then
    raise exception 'Sem permissao para criar link de galeria.';
  end if;
  if not exists (select 1 from public.galerias where id = p_galeria) then
    raise exception 'Galeria nao encontrada.';
  end if;

  -- O nome da galeria na frente, para o link dizer o que é. Cai para a sessão
  -- quando a galeria não tem título, e para 'galeria' quando nem isso — nunca
  -- vazio, senão o token começaria com um hífen.
  select nullif(public.sluguificar(coalesce(g.titulo, s.titulo, '')), '')
    into v_nome
    from public.galerias g
    left join public.sessoes_captacao s on s.id = g.sessao_id
   where g.id = p_galeria;
  v_nome := left(coalesce(v_nome, 'galeria'), 40);

  -- 12 bytes = 96 bits = exatamente 16 caracteres de base64, sem '=' de sobra.
  -- O `translate` faz base64url: '+' e '/' não sobrevivem a uma URL colada no
  -- WhatsApp. O `replace` da quebra de linha é cinto e suspensório — o
  -- `encode` só quebra acima de 76 caracteres, e aqui são 16.
  v_segredo := translate(
    replace(encode(extensions.gen_random_bytes(12), 'base64'), E'\n', ''),
    '+/', '-_');

  v_token := v_nome || '-' || v_segredo;

  insert into public.links_galeria (galeria_id, token_hash, criado_por)
  values (p_galeria, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid())
  returning id into v_id;

  update public.galerias
     set publicada_em = coalesce(publicada_em, now())
   where id = p_galeria;

  -- O token sai UMA vez, aqui. Depois disto so existe o hash.
  return query select v_id, v_token;
end;
$$;

revoke all on function public.criar_link_galeria(uuid) from public, anon;
grant execute on function public.criar_link_galeria(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- E a leitura do visitante devolve a capa
--
-- Muda duas coisas na 0034: a capa entra no objeto, e o piso de tamanho do
-- token cai de 32 para 16. O piso existe para não gastar um sha256 com lixo —
-- e o token novo tem 16 caracteres de segredo mais o nome, então 32 recusaria
-- link legítimo de galeria com nome curto. O que protege o acesso são os 96
-- bits, não o comprimento da string.
-- ---------------------------------------------------------------------------
create or replace function public.galeria_por_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_link    public.links_galeria;
  v_galeria public.galerias;
  v_hash    text;
begin
  if length(coalesce(p_token, '')) < 16 then
    return null;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_link from public.links_galeria where token_hash = v_hash;
  if v_link.id is null or v_link.revogado_em is not null then
    return null;
  end if;

  select * into v_galeria from public.galerias where id = v_link.galeria_id;
  if v_galeria.arquivada_em is not null then
    return null;
  end if;

  update public.links_galeria
     set acessos = acessos + 1, ultimo_acesso_em = now()
   where id = v_link.id;

  return jsonb_build_object(
    'galeriaId', v_galeria.id,
    'titulo', coalesce(v_galeria.titulo, 'Galeria'),
    'recado', v_galeria.recado,
    'permiteDownload', v_galeria.permite_download,
    -- CAMINHO, não URL. Quem assina é a Edge Function, com validade curta,
    -- igual às miniaturas. Caminho de bucket privado não serve para nada solto.
    'capa', (select i.miniatura_caminho
               from public.galeria_itens i
              where i.id = v_galeria.capa_item_id
                and i.galeria_id = v_galeria.id
                and i.pronto),
    'capaItemId', v_galeria.capa_item_id,
    'cliente', (select c.nome from public.clientes c
                  join public.sessoes_captacao s on s.cliente_id = c.id
                 where s.id = v_galeria.sessao_id),
    'quando', (select s.data from public.sessoes_captacao s where s.id = v_galeria.sessao_id),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'tipo', i.tipo,
        'nome', i.nome,
        'caminho', i.caminho,
        'miniatura', i.miniatura_caminho,
        'poster', i.poster_caminho,
        'largura', i.largura,
        'altura', i.altura,
        'duracao', i.duracao_s,
        'bytes', i.tamanho_bytes)
        order by i.ordem)
      from public.galeria_itens i
     where i.galeria_id = v_galeria.id and i.pronto), '[]'::jsonb),
    'favoritos', coalesce((
      select jsonb_agg(f.item_id) from public.galeria_favoritos f
       where f.galeria_id = v_galeria.id), '[]'::jsonb)
  );
end;
$$;

-- SÓ service_role, e isto não é descuido de cópia: `galeria_por_token` recebe
-- um token e devolve a galeria inteira. Quem a alcança pode varrer tokens. Ela
-- é chamada pela Edge Function, que roda com service_role — `authenticated`
-- não tem o que fazer aqui.
--
-- Eu tinha escrito `to authenticated, service_role` nesta linha, por hábito das
-- outras funções desta migration. O `23_smoke_declaracoes.sql` reprovou antes
-- de sair daqui: *"funcao de token alcancavel sem service_role:
-- galeria_por_token -> authenticated"*. É para isso que ele existe — `create or
-- replace` preserva os grants antigos, então um grant a mais passa despercebido
-- sem uma auditoria que varra o catálogo.
revoke all on function public.galeria_por_token(text) from public, anon, authenticated;
grant execute on function public.galeria_por_token(text) to service_role;
