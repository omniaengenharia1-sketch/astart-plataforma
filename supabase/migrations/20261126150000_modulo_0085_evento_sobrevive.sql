-- =============================================================================
-- 0085 — o evento sobrevive à cobrança
--
-- Fui apagar o cliente de teste depois de fechar o ciclo em sandbox e o
-- banco recusou:
--
--   cobranca_eventos e append-only: UPDATE nao e permitido
--   SQL statement "UPDATE ONLY cobranca_eventos SET cobranca_id = NULL ..."
--
-- O `on delete set null` da chave estrangeira é um UPDATE, e o gatilho
-- append-only o barra. Consequência: NENHUMA cobrança com histórico pode ser
-- apagada — e, por cascata, nenhum lançamento nem cliente que já tenha sido
-- cobrado. Um cadastro errado ficaria preso para sempre.
--
-- É a terceira vez neste projeto que o banco recusa um desenho meu e tem
-- razão: antes foi o `publicacao_eventos` append-only e o CHECK de uso
-- coerente das ideias. O padrão é sempre o mesmo — eu ponho uma trava boa e
-- esqueço de perguntar o que mais passa por ali.
--
-- A SAÍDA NÃO É AFROUXAR O APPEND-ONLY. É tirar a chave estrangeira e
-- deixar `cobranca_id` ser um ponteiro solto.
--
-- Um log de auditoria registra O QUE O PROVEDOR DISSE, e isso não deixa de
-- ser verdade quando a linha apontada some. A carga guarda o id da Asaas de
-- qualquer jeito, então a rastreabilidade sobrevive; o que se perde é só o
-- atalho do join, e esse é um preço justo por conseguir apagar um engano.
-- =============================================================================

alter table public.cobranca_eventos
  drop constraint if exists cobranca_eventos_cobranca_id_fkey;

comment on column public.cobranca_eventos.cobranca_id is
  'Ponteiro SOLTO, sem chave estrangeira: o evento sobrevive a cobranca. Com '
  'FK, o `set null` do delete virava UPDATE e batia no append-only, travando '
  'para sempre qualquer cobranca com historico. O id da Asaas fica na carga.';

-- ---------------------------------------------------------------------------
-- E APAGAR LANCAMENTO PASSA A OLHAR A COBRANCA
--
-- `apagar_lancamento` (0077) recusa o que ja foi liquidado. Faltava o caso
-- que so existe desde a 0081: lancamento com cobranca VIVA na Asaas. Apagar
-- aqui sumiria com a linha e deixaria o boleto de pe la — o cliente receberia
-- a cobranca de algo que, para nos, nao existe mais.
--
-- O resto do corpo vem igual da 0077: `create or replace` troca a funcao
-- inteira.
-- ---------------------------------------------------------------------------
create or replace function public.apagar_lancamento(p_lancamento uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.usuario_admin() then
    raise exception 'So a direcao apaga lancamento.';
  end if;
  if exists (select 1 from public.lancamentos
              where id = p_lancamento and status = 'liquidado') then
    raise exception
      'Este lancamento ja foi liquidado — o dinheiro andou. Estorne ou cancele.';
  end if;
  if exists (select 1 from public.cobrancas
              where lancamento_id = p_lancamento and status = 'emitida') then
    raise exception
      'Este lancamento tem cobranca emitida na Asaas. Cancele a cobranca la antes, '
      'senao o cliente recebe um boleto de algo que aqui nao existe mais.';
  end if;

  delete from public.lancamentos where id = p_lancamento;
  if not found then raise exception 'Lancamento nao encontrado.'; end if;
end;
$$;

revoke all on function public.apagar_lancamento(uuid) from public, anon;
grant execute on function public.apagar_lancamento(uuid) to authenticated, service_role;
