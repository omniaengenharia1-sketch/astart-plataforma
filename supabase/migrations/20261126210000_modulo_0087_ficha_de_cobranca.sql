-- =============================================================================
-- 0087 — o documento dos clientes que JA existem
--
-- A 0086 pede CPF/CNPJ no cadastro. Mas RavhaPay, Karla Bernardo, KB Advogados
-- e todos os outros nasceram antes dela: estao no banco com `cnpj_cpf` nulo, e
-- `cobrancas_para_emitir` passa por cima deles sem dizer nada.
--
-- `salvar_dados_de_cobranca` (0081) ja sabe gravar. O que faltava era (a) uma
-- tela e (b) uma funcao que LEIA o que esta la — porque um formulario que nao
-- mostra o valor atual e um formulario que a pessoa preenche de novo toda vez,
-- e na duvida apaga o que estava certo.
--
-- POR QUE UMA FUNCAO NOVA EM VEZ DE MEXER NA `ficha_cliente`
--
-- A `ficha_cliente` tem centenas de linhas e monta a tela inteira. Trocar ela
-- por um `create or replace` para acrescentar tres campos e arriscar o resto
-- da ficha por um campo de texto. Uma funcao pequena ao lado nao pode quebrar
-- nada que ja funciona.
--
-- QUEM VE
--
-- Documento e telefone de cliente sao dado pessoal. Mesma regra do dinheiro:
-- quem cuida do financeiro e a direcao. Nao e `authenticated` inteiro — a
-- equipe de criacao nao precisa do CPF de ninguem para fazer um carrossel.
-- =============================================================================

create or replace function public.dados_de_cobranca(p_cliente uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_linha record;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Dados de cobrança são de quem cuida do dinheiro.';
  end if;

  select c.nome, c.cnpj_cpf, c.email_cobranca, c.telefone,
         c.asaas_customer_id, c.asaas_ambiente
    into v_linha
    from public.clientes c
   where c.id = p_cliente;

  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  return jsonb_build_object(
    'nome',     v_linha.nome,
    'cnpjCpf',  v_linha.cnpj_cpf,
    'email',    v_linha.email_cobranca,
    'telefone', v_linha.telefone,
    -- Se ele ja existe la, a tela diz em qual ambiente. Trocar o documento de
    -- um cliente que a Asaas ja conhece nao renomeia o cadastro de la, e e bom
    -- que quem mexe saiba disso antes de mexer.
    'naAsaas',  v_linha.asaas_customer_id is not null,
    'ambiente', v_linha.asaas_ambiente);
end;
$$;

revoke all on function public.dados_de_cobranca(uuid) from public, anon;
grant execute on function public.dados_de_cobranca(uuid) to authenticated, service_role;

comment on function public.dados_de_cobranca(uuid) is
  'Le CPF/CNPJ, e-mail e telefone de cobranca de um cliente. So financeiro e direcao.';

-- ---------------------------------------------------------------------------
-- E os acentos de quem grava
--
-- `salvar_dados_de_cobranca` escrevia "Dados de cobranca sao de quem cuida do
-- dinheiro." e "CPF tem 11 digitos e CNPJ tem 14." na tela dela. O corpo abaixo
-- e o da 0081, linha por linha; so os textos mudaram.
-- ---------------------------------------------------------------------------
create or replace function public.salvar_dados_de_cobranca(
  p_cliente  uuid,
  p_cnpj_cpf text default null,
  p_email    text default null,
  p_telefone text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_digitos text;
begin
  if not public.usuario_financeiro() and not public.usuario_admin() then
    raise exception 'Dados de cobrança são de quem cuida do dinheiro.';
  end if;

  -- Tira mascara aqui, uma vez, em vez de confiar em toda tela que escrever.
  v_digitos := nullif(regexp_replace(coalesce(p_cnpj_cpf, ''), '[^0-9]', '', 'g'), '');
  if v_digitos is not null and length(v_digitos) not in (11, 14) then
    raise exception 'CPF tem 11 dígitos e CNPJ tem 14. Vieram %.', length(v_digitos);
  end if;

  update public.clientes set
    cnpj_cpf       = coalesce(v_digitos, cnpj_cpf),
    email_cobranca = coalesce(nullif(btrim(coalesce(p_email, '')), ''), email_cobranca),
    telefone       = coalesce(
      nullif(regexp_replace(coalesce(p_telefone, ''), '[^0-9]', '', 'g'), ''), telefone)
  where id = p_cliente;

  if not found then raise exception 'Cliente não encontrado.'; end if;
end;
$$;
