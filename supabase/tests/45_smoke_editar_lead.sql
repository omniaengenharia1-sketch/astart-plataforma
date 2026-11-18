-- =============================================================================
-- Smoke do EDITAR LEAD — a convencao de "nao mexe" e a de "apaga".
--
-- `editar_lead` nasceu na 0071, passou no 41 por omissao (o 41 nao a chama em
-- lugar nenhum) e ficou meses sem tela nenhuma que a chamasse. Quando a tela
-- finalmente foi escrita, o primeiro erro que eu cometi foi mandar
-- `valor_centavos` em `p_limpar` — o nome da COLUNA — quando a funcao espera
-- `valor`. Nada explode: a funcao ignora a chave que nao conhece e o campo
-- simplesmente nao e apagado. Silencioso, que e o pior tipo.
--
-- Entao e isso que este arquivo trava:
--
--   1. nulo quer dizer NAO MEXE — editar so o telefone nao apaga a empresa;
--   2. `p_limpar` apaga de verdade, campo a campo;
--   3. a chave do valor e `valor`, e uma chave DESCONHECIDA nao apaga nada
--      nem levanta erro — por isso o nome certo precisa de teste;
--   4. nome vazio e valor negativo sao recusados, com mensagem;
--   5. apagar um lead que NAO virou cliente funciona de verdade;
--   6. e quem cuida do dinheiro sem ser a direcao EDITA mas nao APAGA —
--      `editar_lead` pede `usuario_financeiro`, `apagar_lead` pede
--      `usuario_admin`, e essa diferenca de uma palavra nao tinha teste.
--
-- O 3 e o 6 sao os que justificam o arquivo.
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
  ('10000000-0000-0000-0000-000000000003', 'financeiro@astartstudio.com.br');
insert into public.perfis (user_id, nome, papel, ativo, email) values
  ('10000000-0000-0000-0000-000000000001', 'Layana', 'admin',      true, 'direcao@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000003', 'Nara',   'financeiro', true, 'financeiro@astartstudio.com.br');

do $$
declare
  v_l uuid;
  ok  boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000001', false);

  v_l := public.criar_lead('Padaria da Esquina', 'Padaria LTDA', '11988887777');
  perform public.editar_lead(v_l, p_valor_centavos => 250000, p_origem => 'indicacao');

  -- 1. NULO E "NAO MEXE".
  --
  -- A tela manda todos os campos em toda edicao. Se nulo apagasse, corrigir
  -- o telefone zeraria a empresa e o valor sem ninguem pedir.
  perform public.editar_lead(v_l, p_whatsapp => '11955554444');
  perform public.afirma(
    (select whatsapp from public.leads where id = v_l) = '11955554444',
    'editar troca o telefone');
  perform public.afirma(
    (select empresa from public.leads where id = v_l) = 'Padaria LTDA',
    'e nao encosta na empresa, que foi mandada nula');
  perform public.afirma(
    (select valor_estimado_centavos from public.leads where id = v_l) = 250000,
    'nem no valor');
  perform public.afirma(
    (select origem from public.leads where id = v_l) = 'indicacao',
    'nem na origem');

  -- Texto so de espaco tambem e "nao mexe", nao "apaga". Quem quer apagar
  -- usa `p_limpar`; um campo que ficou com um espaco por engano nao pode
  -- virar um apagamento.
  perform public.editar_lead(v_l, p_empresa => '   ');
  perform public.afirma(
    (select empresa from public.leads where id = v_l) = 'Padaria LTDA',
    'mandar so espaco nao apaga a empresa');

  -- 3. CHAVE DESCONHECIDA NAO APAGA, E NAO RECLAMA.
  --
  -- Este e o defeito que eu cometi na tela. A funcao nao valida o nome da
  -- chave: `valor_centavos` simplesmente nao casa com nada, e o valor fica.
  -- Nenhuma excecao, nenhum aviso. So um botao que parece funcionar.
  perform public.editar_lead(v_l, p_limpar => array['valor_centavos']);
  perform public.afirma(
    (select valor_estimado_centavos from public.leads where id = v_l) = 250000,
    'chave errada em p_limpar nao apaga nada — e nao levanta erro nenhum');

  -- 2. E A CHAVE CERTA APAGA.
  perform public.editar_lead(v_l, p_limpar => array['valor']);
  perform public.afirma(
    (select valor_estimado_centavos is null from public.leads where id = v_l),
    'a chave do valor e "valor", e com ela o valor sai');

  perform public.editar_lead(v_l, p_limpar => array['empresa', 'whatsapp', 'origem']);
  perform public.afirma(
    (select empresa is null and whatsapp is null and origem is null
       from public.leads where id = v_l),
    'e limpar apaga empresa, telefone e origem de uma vez');
  perform public.afirma(
    (select nome from public.leads where id = v_l) = 'Padaria da Esquina',
    'mas o nome fica: lead sem nome nao existe');

  -- 4. O QUE E RECUSADO, E COM QUE PALAVRAS.
  begin
    perform public.editar_lead(v_l, p_nome => '   ');
    ok := false;
  exception when others then ok := position('nome' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'nome vazio e recusado, dizendo que e o nome');

  begin
    perform public.editar_lead(v_l, p_valor_centavos => -1);
    ok := false;
  exception when others then ok := position('negativo' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'valor negativo e recusado');

  begin
    perform public.editar_lead('00000000-0000-0000-0000-0000000000ff', p_nome => 'Fantasma');
    ok := false;
  exception when others then ok := position('nao encontrado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'editar lead que nao existe e recusado, em vez de passar calado');

  -- 5. APAGAR O QUE NAO VIROU CLIENTE FUNCIONA MESMO.
  --
  -- O 41 prova que lead convertido NAO sai. Ninguem provava que o outro sai.
  perform public.apagar_lead(v_l);
  perform public.afirma(
    not exists (select 1 from public.leads where id = v_l),
    'lead que nao virou cliente e apagado de verdade');

  begin
    perform public.apagar_lead(v_l);
    ok := false;
  exception when others then ok := position('nao encontrado' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'e apagar duas vezes avisa, em vez de fingir que deu certo');
end $$;

-- ---------------------------------------------------------------------------
-- 6. O FINANCEIRO EDITA. SO A DIRECAO APAGA.
--
-- "eu quero que apenas eu que tenho acesso proprietario possa ver a parte
-- financeira ou alguem que eu cadastre como financeiro" — o financeiro
-- trabalha o funil inteiro. Apagar e outra coisa: leva o historico junto, e
-- e so para desfazer engano. Uma palavra de diferenca entre as duas funcoes,
-- e nenhum teste olhava para ela.
-- ---------------------------------------------------------------------------
do $$
declare
  v_l uuid;
  ok  boolean;
begin
  perform set_config('teste.uid', '10000000-0000-0000-0000-000000000003', false);

  v_l := public.criar_lead('Lead da Nara');
  perform public.editar_lead(v_l, p_empresa => 'Mercado do Bairro');
  perform public.afirma(
    (select empresa from public.leads where id = v_l) = 'Mercado do Bairro',
    'quem cuida do dinheiro edita o lead');

  begin
    perform public.apagar_lead(v_l);
    ok := false;
  exception when others then ok := position('direcao' in sqlerrm) > 0;
  end;
  perform public.afirma(ok, 'mas nao apaga — apagar e so da direcao');
  perform public.afirma(
    exists (select 1 from public.leads where id = v_l),
    'e o lead continua ali depois da recusa');
end $$;
