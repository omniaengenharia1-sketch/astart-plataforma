-- 0053 — o campo de upload do contrato, do relatório e do NPS.
--
-- A dona disse, depois de eu propor três formulários: "eu acho que é só você
-- deixar um campo pra upload do contrato, relatório e nps". Ela está certa, e
-- o schema já concordava com ela desde a fundação:
--
--   `cliente_documentos` (0015) nasceu com `tipo` (proposta/contrato/outro),
--   `nome` e `caminho` — "caminho no bucket privado, nunca URL pública".
--
--   `relatorios_campanha` (0021) nasceu com `arquivo_nome` e
--   `arquivo_caminho`. Ou seja: o relatório de campanha SEMPRE foi pensado
--   como arquivo, e a tabela `campanhas` filha é o detalhe estruturado
--   opcional, não o caminho principal.
--
-- As duas tabelas tinham RLS, índice, comentário — e **zero escritores em todo
-- o sistema**, e nenhum bucket onde o arquivo pudesse cair. É o mesmo buraco
-- de `contas_sociais` até a 0044: a casa inteira construída e sem porta.
--
-- Eu ia construir formulário de digitar métrica. A agência não digita métrica:
-- ela exporta o relatório que já faz e anexa. Perguntar antes de construir
-- economizou um módulo inteiro na direção errada.
--
-- Três decisões:
--
-- 1. UM BUCKET, e a permissão vem da LINHA, não do caminho.
--    As outras duas políticas de bucket deste projeto leem o caminho para
--    saber de quem é o arquivo (`<cliente_id>/...`). Aqui a pergunta é outra:
--    "este cliente pode ver ESTE documento?" — e a resposta está na linha, no
--    `visivel_ao_cliente`. Política por formato de caminho não saberia
--    responder isso. Efeito colateral bom: arquivo órfão (subiu, e o registro
--    falhou) não é legível por ninguém além da equipe.
--
-- 2. O PADRÃO DEPENDE DO TIPO, e isso veio da dona.
--    Eu havia escrito "upload não publica": tudo nasce invisível, e quem anexa
--    decide depois. Perguntei, e a resposta foi outra: **o cliente vê sempre o
--    contrato dele**. Faz sentido e eu não tinha pensado assim — o contrato
--    assinado é dos dois, e esconder o documento que a pessoa assinou é
--    burocracia, não cuidado.
--
--    Então: `contrato` nasce VISÍVEL; `proposta` e `outro` nascem invisíveis.
--    A proposta é o caso que justifica o padrão — ela tem preço de custo e
--    margem. E `outro` é onde cai relatório interno e resultado de NPS bruto,
--    que também não é material de portal.
--
--    O default da COLUNA segue falso. Quem decide é a função, que sabe o tipo;
--    uma linha inserida por outro caminho qualquer nasce fechada, que é o lado
--    seguro de errar.
--
-- 3. O RELATÓRIO DE CAMPANHA É DO CLIENTE por natureza: é o que a agência
--    entrega. Então ele não tem chave de visibilidade; vale o módulo
--    `campanhas` no contrato, que é o mesmo portão da aba onde ele aparece.

-- ---------------------------------------------------------------------------
-- 1. A chave de visibilidade
-- ---------------------------------------------------------------------------
alter table public.cliente_documentos
  add column if not exists visivel_ao_cliente boolean not null default false;

comment on column public.cliente_documentos.visivel_ao_cliente is
  'Quem decide o padrao e a funcao, que sabe o tipo: contrato nasce visivel, '
  'proposta e outro nascem fechados. O default da coluna e falso porque linha '
  'inserida por outro caminho tem de nascer fechada.';

-- ---------------------------------------------------------------------------
-- 2. O bucket
--
-- Privado, como os outros dois. 200 MiB: contrato escaneado em PDF e
-- relatório de campanha com imagens passam de 10 MB com folga, e nada aqui é
-- vídeo.
--
-- Os tipos aceitos são os que uma agência realmente anexa. `allowed_mime_types`
-- é a primeira guarda e é do lado do servidor: o navegador pode mentir no
-- `accept` do input, o bucket não.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos',
  'documentos',
  false,
  209715200,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp',
    -- Planilha e apresentação: relatório de campanha sai assim com frequência.
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 3. Quem lê um arquivo deste bucket
--
-- A autoridade é a LINHA que aponta para o caminho, não o caminho. Equipe lê
-- tudo; o cliente lê o documento que foi marcado como visível, e o relatório
-- de campanha quando o contrato dele liga o módulo `campanhas`.
--
-- `security definer` pela mesma razão da 0035 e da 0038: a política roda como
-- quem pediu o arquivo, e um cliente não enxerga `cliente_documentos` de
-- outros — a armadilha de RLS número um deste projeto.
-- ---------------------------------------------------------------------------
create or replace function public.usuario_ve_documento(p_caminho text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.usuario_ativo()
      or exists (
           select 1 from public.cliente_documentos d
            where d.caminho = p_caminho
              and d.visivel_ao_cliente
              and public.usuario_ve_cliente(d.cliente_id)
         )
      or exists (
           select 1 from public.relatorios_campanha r
            where r.arquivo_caminho = p_caminho
              and public.usuario_ve_cliente(r.cliente_id)
              and public.cliente_tem_modulo(r.cliente_id, 'campanhas')
         );
$$;

revoke all on function public.usuario_ve_documento(text) from public, anon;
grant execute on function public.usuario_ve_documento(text) to authenticated, service_role;

drop policy if exists documentos_le on storage.objects;
create policy documentos_le on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos' and public.usuario_ve_documento(name));

-- Escrever, trocar e apagar arquivo é da equipe que edita. Ninguém de fora
-- escolhe sob qual pasta o arquivo cai — a mesma regra da 0008.
drop policy if exists documentos_escreve on storage.objects;
create policy documentos_escreve on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos' and public.usuario_edita());

drop policy if exists documentos_atualiza on storage.objects;
create policy documentos_atualiza on storage.objects
  for update to authenticated
  using (bucket_id = 'documentos' and public.usuario_edita())
  with check (bucket_id = 'documentos' and public.usuario_edita());

drop policy if exists documentos_apaga on storage.objects;
create policy documentos_apaga on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos' and public.usuario_edita());

-- ---------------------------------------------------------------------------
-- 4. Registrar o documento
--
-- O caminho TEM de começar pelo id do cliente. Não é organização: é o que
-- todas as telas e scripts deste projeto assumem, e um arquivo fora da
-- convenção fica num lugar que ninguém varre. A `cliente_do_caminho_midia()`
-- da 0038 lê isso — o nome dela diz "midia" por ter nascido lá, e a regra é
-- genérica: o primeiro pedaço do caminho é o cliente. Reusar é melhor que
-- clonar com outro nome, que é como duas guardas começam a discordar.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_documento_do_cliente(
  p_cliente  uuid,
  p_tipo     text,
  p_nome     text,
  p_caminho  text,
  -- Nulo quer dizer "use o padrao do tipo", e nao "esconda". A tela manda nulo
  -- no upload comum e manda explicito quando a pessoa marca a caixa.
  p_visivel  boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id      uuid;
  v_visivel boolean;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para anexar documento.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;
  if p_tipo not in ('proposta', 'contrato', 'outro') then
    raise exception
      'Tipo de documento "%" nao existe: use proposta, contrato ou outro.', p_tipo;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'De um nome ao documento, para a equipe achar depois.';
  end if;
  if public.cliente_do_caminho_midia(p_caminho) is distinct from p_cliente then
    raise exception
      'O caminho do arquivo tem de comecar pelo id do cliente (%), senao ninguem '
      'consegue le-lo.', p_cliente;
  end if;

  -- O padrao do TIPO. Contrato assinado e dos dois lados: esconder o documento
  -- que a pessoa assinou e burocracia, nao cuidado.
  v_visivel := coalesce(p_visivel, p_tipo = 'contrato');

  insert into public.cliente_documentos
    (cliente_id, tipo, nome, caminho, enviado_por, visivel_ao_cliente)
  values
    (p_cliente, p_tipo::public.tipo_documento, btrim(p_nome), p_caminho, auth.uid(),
     v_visivel)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'visivelAoCliente', v_visivel);
end;
$$;

revoke all on function public.registrar_documento_do_cliente(uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.registrar_documento_do_cliente(uuid, text, text, text, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Mostrar ou esconder do cliente
-- ---------------------------------------------------------------------------
create or replace function public.mudar_visibilidade_do_documento(
  p_documento uuid,
  p_visivel   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_doc public.cliente_documentos;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para mexer em documento.';
  end if;

  select * into v_doc from public.cliente_documentos d where d.id = p_documento;
  if not found or not public.usuario_ve_cliente(v_doc.cliente_id) then
    raise exception 'Documento % nao encontrado.', p_documento;
  end if;

  update public.cliente_documentos
     set visivel_ao_cliente = coalesce(p_visivel, false)
   where id = p_documento;

  return jsonb_build_object('id', p_documento, 'visivelAoCliente', coalesce(p_visivel, false));
end;
$$;

revoke all on function public.mudar_visibilidade_do_documento(uuid, boolean) from public, anon;
grant execute on function public.mudar_visibilidade_do_documento(uuid, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Tirar o documento
--
-- Devolve o caminho para quem chamou apagar o arquivo no Storage depois. A
-- linha sai primeiro, como no `remover_midia_post()` da 0045: arquivo que
-- sobra no bucket é desperdício; linha apontando para arquivo que não existe é
-- um documento quebrado na cara de quem clica.
-- ---------------------------------------------------------------------------
create or replace function public.remover_documento_do_cliente(p_documento uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_doc public.cliente_documentos;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para tirar documento.';
  end if;

  select * into v_doc from public.cliente_documentos d where d.id = p_documento;
  if not found or not public.usuario_ve_cliente(v_doc.cliente_id) then
    raise exception 'Documento % nao encontrado.', p_documento;
  end if;

  delete from public.cliente_documentos where id = p_documento;

  return jsonb_build_object('caminho', v_doc.caminho, 'nome', v_doc.nome);
end;
$$;

revoke all on function public.remover_documento_do_cliente(uuid) from public, anon;
grant execute on function public.remover_documento_do_cliente(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Ler os documentos de um cliente
--
-- O cliente recebe só o que foi marcado como visível. Filtrar aqui e não na
-- tela é de propósito: a tela do portal e a da equipe são a mesma, e uma
-- condição de render esquecida mostraria a proposta com preço de custo.
-- ---------------------------------------------------------------------------
create or replace function public.documentos_do_cliente(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_equipe boolean;
  v jsonb;
begin
  if not public.usuario_ve_cliente(p_cliente) then
    return null;
  end if;
  v_equipe := public.usuario_ativo();

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',     d.id,
             'tipo',   d.tipo,
             'nome',   d.nome,
             'caminho', d.caminho,
             'visivelAoCliente', d.visivel_ao_cliente,
             'enviadoEm', d.criado_em
           ) order by d.criado_em desc
         ), '[]'::jsonb)
    into v
    from public.cliente_documentos d
   where d.cliente_id = p_cliente
     and (v_equipe or d.visivel_ao_cliente);

  return v;
end;
$$;

revoke all on function public.documentos_do_cliente(uuid) from public, anon;
grant execute on function public.documentos_do_cliente(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. O relatório de campanha
--
-- `unique (cliente_id, periodo_inicio, periodo_fim)` já estava na 0021: um
-- relatório por período. Então reenviar o mesmo período TROCA o arquivo, e a
-- função devolve o caminho do antigo para quem chamou apagá-lo do bucket —
-- senão cada correção de relatório deixaria um arquivo morto lá dentro.
--
-- Recusar o reenvio seria pior: a correção de um relatório é rotina, e a
-- alternativa seria a pessoa inventar um período de um dia a mais para
-- conseguir subir a versão certa.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_relatorio_de_campanha(
  p_cliente  uuid,
  p_de       date,
  p_ate      date,
  p_nome     text,
  p_caminho  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_antigo   text;
  v_trocou   boolean := false;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para anexar relatorio.';
  end if;
  if not public.usuario_ve_cliente(p_cliente) then
    raise exception 'Cliente % nao encontrado.', p_cliente;
  end if;
  if not public.cliente_tem_modulo(p_cliente, 'campanhas') then
    raise exception
      'Este cliente nao tem trafego pago no contrato, entao a aba de campanhas '
      'nao existe para ele. Ligue o modulo no contrato antes.';
  end if;
  if p_de is null or p_ate is null then
    raise exception 'Diga o periodo do relatorio: de quando ate quando.';
  end if;
  if p_ate < p_de then
    raise exception 'O fim do periodo (%) e antes do inicio (%). Confira as datas.', p_ate, p_de;
  end if;
  if length(btrim(coalesce(p_nome, ''))) = 0 then
    raise exception 'De um nome ao relatorio.';
  end if;
  if public.cliente_do_caminho_midia(p_caminho) is distinct from p_cliente then
    raise exception
      'O caminho do arquivo tem de comecar pelo id do cliente (%), senao ninguem '
      'consegue le-lo.', p_cliente;
  end if;

  select r.id, r.arquivo_caminho into v_id, v_antigo
    from public.relatorios_campanha r
   where r.cliente_id = p_cliente
     and r.periodo_inicio = p_de
     and r.periodo_fim = p_ate;

  if found then
    update public.relatorios_campanha
       set arquivo_nome = btrim(p_nome),
           arquivo_caminho = p_caminho,
           enviado_por = auth.uid(),
           enviado_em = now()
     where id = v_id;
    v_trocou := v_antigo is not null and v_antigo <> p_caminho;
  else
    insert into public.relatorios_campanha
      (cliente_id, periodo_inicio, periodo_fim, arquivo_nome, arquivo_caminho, enviado_por)
    values
      (p_cliente, p_de, p_ate, btrim(p_nome), p_caminho, auth.uid())
    returning id into v_id;
    v_antigo := null;
  end if;

  return jsonb_build_object(
    'id', v_id,
    -- Quem chamou apaga este arquivo do bucket. Nulo quando nada foi trocado.
    'caminhoAntigo', case when v_trocou then v_antigo else null end
  );
end;
$$;

revoke all on function public.registrar_relatorio_de_campanha(uuid, date, date, text, text)
  from public, anon;
grant execute on function public.registrar_relatorio_de_campanha(uuid, date, date, text, text)
  to authenticated, service_role;

create or replace function public.remover_relatorio_de_campanha(p_relatorio uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_rel public.relatorios_campanha;
begin
  if not public.usuario_edita() then
    raise exception 'Voce nao tem permissao para tirar relatorio.';
  end if;

  select * into v_rel from public.relatorios_campanha r where r.id = p_relatorio;
  if not found or not public.usuario_ve_cliente(v_rel.cliente_id) then
    raise exception 'Relatorio % nao encontrado.', p_relatorio;
  end if;

  -- As campanhas detalhadas vao com ele: `on delete cascade` da 0021. Elas sao
  -- o detalhe DAQUELE relatorio, nao historico independente.
  delete from public.relatorios_campanha where id = p_relatorio;

  return jsonb_build_object('caminho', v_rel.arquivo_caminho, 'nome', v_rel.arquivo_nome);
end;
$$;

revoke all on function public.remover_relatorio_de_campanha(uuid) from public, anon;
grant execute on function public.remover_relatorio_de_campanha(uuid) to authenticated, service_role;
