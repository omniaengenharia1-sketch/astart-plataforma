-- =============================================================================
-- Smoke da 0053. O que este teste cobra:
--   1. anexar documento, e o caminho TEM de comecar pelo id do cliente;
--   2. ANEXAR NAO PUBLICA: `visivel_ao_cliente` nasce falso;
--   3. o cliente le so o que foi marcado — e o filtro e no BANCO, nao na tela;
--   4. operacao anexa, leitura nao;
--   5. relatorio de campanha exige o modulo no contrato;
--   6. reenviar o mesmo periodo TROCA o arquivo e devolve o caminho antigo
--      para o chamador apagar — senao cada correcao deixa lixo no bucket;
--   7. tirar devolve o caminho, para o arquivo sair do Storage depois.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'operacao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000004', 'leitura@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@padaria.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Direcao',  'admin',    true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'Operacao', 'operacao', true, 'operacao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000004', 'Leitura',  'leitura',  true, 'leitura@astartstudio.com.br');

insert into public.clientes (id, nome, slug, fuso_horario) values
  ('20000000-0000-0000-0000-000000000001', 'Padaria Aurora', 'padaria-aurora', 'America/Sao_Paulo'),
  ('20000000-0000-0000-0000-000000000009', 'Sem trafego',    'sem-trafego',    'America/Sao_Paulo');

-- Gestao Digital com o modulo opcional de campanhas ligado no primeiro; o
-- segundo fica sem, para cobrar a recusa do relatorio.
insert into public.cliente_servicos (cliente_id, servico_id, formato, valor_centavos, dia_vencimento, inicio)
select c.id, s.id, 'recorrente', 280000, 10, current_date
  from public.clientes c, public.servicos s
 where s.chave = 'gestao_digital' and c.slug in ('padaria-aurora', 'sem-trafego');

insert into public.cliente_servico_modulos (cliente_servico_id, modulo_id, ligado)
select cs.id, m.id, true
  from public.cliente_servicos cs
  join public.clientes c  on c.id = cs.cliente_id
  join public.servico_modulos sm on sm.servico_id = cs.servico_id
  join public.modulos m   on m.id = sm.modulo_id
 where c.slug = 'padaria-aurora' and m.chave = 'campanhas' and sm.opcional;

-- O acesso do cliente ao proprio cadastro.
insert into public.clientes_usuarios (cliente_id, user_id, nome, email, ativo)
values ('20000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-00000000000a', 'Bruna', 'bruna@padaria.com.br', true);

-- ---------------------------------------------------------------------------
-- 1 e 2. Anexar, e anexar NAO publicar
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  ok boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- Caminho fora da convencao: recusa ANTES de criar linha apontando para um
  -- arquivo que ninguem conseguiria abrir.
  begin
    perform public.registrar_documento_do_cliente(
      '20000000-0000-0000-0000-000000000001', 'contrato', 'Contrato 2026',
      'contratos/qualquer.pdf');
    ok := false;
  exception when others then
    ok := position('comecar pelo id do cliente' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'caminho fora da convencao e recusado');

  -- Tipo inventado recusa dizendo quais existem.
  begin
    perform public.registrar_documento_do_cliente(
      '20000000-0000-0000-0000-000000000001', 'nota_fiscal', 'NF',
      '20000000-0000-0000-0000-000000000001/doc/nf.pdf');
    ok := false;
  exception when others then
    ok := position('proposta, contrato ou outro' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'tipo invalido e recusado dizendo os que existem');

  v := public.registrar_documento_do_cliente(
    '20000000-0000-0000-0000-000000000001', 'contrato', 'Contrato assinado 2026',
    '20000000-0000-0000-0000-000000000001/doc/contrato.pdf');

  perform public.afirma(v->>'id' is not null, 'anexou o contrato');
  -- O padrao vem do TIPO, e foi a dona que decidiu: o cliente ve sempre o
  -- contrato dele. Eu havia escrito o contrario — tudo nasce fechado — e a
  -- pergunta me corrigiu.
  perform public.afirma(
    (v->>'visivelAoCliente')::boolean,
    'contrato nasce VISIVEL: o documento assinado e dos dois lados'
  );

  -- E uma proposta, que e o caso que justifica o padrao fechado: tem preco de
  -- custo e margem.
  v := public.registrar_documento_do_cliente(
    '20000000-0000-0000-0000-000000000001', 'proposta', 'Proposta com margem',
    '20000000-0000-0000-0000-000000000001/doc/proposta.pdf');
  perform public.afirma(
    not (v->>'visivelAoCliente')::boolean,
    'proposta nasce FECHADA'
  );

  -- E o explicito ganha do padrao, nos dois sentidos.
  v := public.registrar_documento_do_cliente(
    '20000000-0000-0000-0000-000000000001', 'contrato', 'Contrato em negociacao',
    '20000000-0000-0000-0000-000000000001/doc/rascunho.pdf', false);
  perform public.afirma(
    not (v->>'visivelAoCliente')::boolean,
    'contrato marcado como fechado continua fechado — rascunho em negociacao'
  );
  perform public.remover_documento_do_cliente((v->>'id')::uuid);
end $$;

-- ---------------------------------------------------------------------------
-- 3. O cliente le so o que foi marcado — e o filtro e no BANCO
-- ---------------------------------------------------------------------------
do $$
declare
  v_doc uuid;
  v jsonb;
begin
  perform set_config('teste.uid', '20000000-0000-0000-0000-00000000000a', false);
  v := public.documentos_do_cliente('20000000-0000-0000-0000-000000000001');
  perform public.afirma(jsonb_array_length(v) = 1, 'o cliente ve um documento');
  perform public.afirma(
    v->0->>'tipo' = 'contrato',
    'e e o contrato, NAO a proposta com margem'
  );

  -- A equipe ve os dois.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  v := public.documentos_do_cliente('20000000-0000-0000-0000-000000000001');
  perform public.afirma(jsonb_array_length(v) = 2, 'a equipe ve os dois');

  -- Esconder o contrato tambem tem de funcionar: contrato substituido por uma
  -- versao nova nao fica dos dois jeitos no portal.
  select id into v_doc from public.cliente_documentos
   where cliente_id = '20000000-0000-0000-0000-000000000001' and tipo = 'contrato';
  perform public.mudar_visibilidade_do_documento(v_doc, false);

  perform set_config('teste.uid', '20000000-0000-0000-0000-00000000000a', false);
  perform public.afirma(
    jsonb_array_length(public.documentos_do_cliente('20000000-0000-0000-0000-000000000001')) = 0,
    'escondido, o cliente nao ve mais'
  );

  -- E de volta, que e o estado que o resto do teste espera.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  perform public.mudar_visibilidade_do_documento(v_doc, true);
  perform set_config('teste.uid', '20000000-0000-0000-0000-00000000000a', false);

  -- A politica do bucket concorda com a funcao: a autoridade e a LINHA.
  perform public.afirma(
    public.usuario_ve_documento('20000000-0000-0000-0000-000000000001/doc/contrato.pdf'),
    'o cliente le o arquivo do contrato no bucket'
  );
  perform public.afirma(
    not public.usuario_ve_documento('20000000-0000-0000-0000-000000000001/doc/proposta.pdf'),
    'e NAO le o arquivo da proposta'
  );
  -- Arquivo orfao (subiu e o registro falhou) nao e legivel por ninguem de fora.
  perform public.afirma(
    not public.usuario_ve_documento('20000000-0000-0000-0000-000000000001/doc/orfao.pdf'),
    'arquivo sem linha nao e legivel pelo cliente'
  );
end $$;

-- ---------------------------------------------------------------------------
-- 4. Quem anexa
-- ---------------------------------------------------------------------------
do $$
declare ok boolean;
begin
  -- Operacao anexa: e trabalho do dia.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000002', false);
  perform public.registrar_documento_do_cliente(
    '20000000-0000-0000-0000-000000000001', 'outro', 'NPS de outubro',
    '20000000-0000-0000-0000-000000000001/doc/nps-out.pdf');

  -- Leitura nao.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000004', false);
  begin
    perform public.registrar_documento_do_cliente(
      '20000000-0000-0000-0000-000000000001', 'outro', 'Tentativa',
      '20000000-0000-0000-0000-000000000001/doc/x.pdf');
    ok := false;
  exception when others then
    ok := position('permissao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'papel leitura nao anexa documento');
end $$;

-- ---------------------------------------------------------------------------
-- 5, 6 e 7. O relatorio de campanha
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  ok boolean;
  v_rel uuid;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  -- Cliente sem o modulo: recusa, porque a aba nem existe para ele.
  begin
    perform public.registrar_relatorio_de_campanha(
      '20000000-0000-0000-0000-000000000009', current_date - 30, current_date,
      'Relatorio', '20000000-0000-0000-0000-000000000009/camp/r.pdf');
    ok := false;
  exception when others then
    ok := position('trafego pago no contrato' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'relatorio exige o modulo de campanhas no contrato');

  -- Periodo invertido.
  begin
    perform public.registrar_relatorio_de_campanha(
      '20000000-0000-0000-0000-000000000001', current_date, current_date - 30,
      'Relatorio', '20000000-0000-0000-0000-000000000001/camp/r.pdf');
    ok := false;
  exception when others then
    ok := position('antes do inicio' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'periodo invertido e recusado');

  -- O primeiro envio.
  v := public.registrar_relatorio_de_campanha(
    '20000000-0000-0000-0000-000000000001', date '2026-09-01', date '2026-09-30',
    'Setembro 2026', '20000000-0000-0000-0000-000000000001/camp/set.pdf');
  perform public.afirma(v->>'id' is not null, 'anexou o relatorio');
  perform public.afirma(
    v->'caminhoAntigo' = 'null'::jsonb,
    'primeiro envio nao tem arquivo antigo para apagar'
  );

  -- 6. A CORRECAO: mesmo periodo, arquivo novo. Troca, e devolve o antigo.
  v := public.registrar_relatorio_de_campanha(
    '20000000-0000-0000-0000-000000000001', date '2026-09-01', date '2026-09-30',
    'Setembro 2026 (corrigido)',
    '20000000-0000-0000-0000-000000000001/camp/set-v2.pdf');
  perform public.afirma(
    v->>'caminhoAntigo' = '20000000-0000-0000-0000-000000000001/camp/set.pdf',
    'reenviar devolve o caminho do antigo, para o chamador apagar do bucket'
  );
  perform public.afirma(
    (select count(*) from public.relatorios_campanha
      where cliente_id = '20000000-0000-0000-0000-000000000001') = 1,
    'e continua um relatorio por periodo, nao dois'
  );

  -- O cliente le o arquivo do relatorio sem precisar de marcacao: relatorio e
  -- o que a agencia entrega, e o portao e o modulo no contrato.
  perform set_config('teste.uid', '20000000-0000-0000-0000-00000000000a', false);
  perform public.afirma(
    public.usuario_ve_documento('20000000-0000-0000-0000-000000000001/camp/set-v2.pdf'),
    'o cliente le o relatorio de campanha'
  );

  -- 7. Tirar devolve o caminho.
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);
  select id into v_rel from public.relatorios_campanha
   where cliente_id = '20000000-0000-0000-0000-000000000001';
  v := public.remover_relatorio_de_campanha(v_rel);
  perform public.afirma(
    v->>'caminho' = '20000000-0000-0000-0000-000000000001/camp/set-v2.pdf',
    'tirar devolve o caminho para o arquivo sair do Storage'
  );
end $$;

select 'arquivos conferidos' as resultado;
