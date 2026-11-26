-- =============================================================================
-- 0084 — o pix que chega depois
--
-- O primeiro ciclo de verdade em sandbox emitiu a cobrança certa e gravou
-- `pix: false`. Fui ver o porquê: a Asaas **gera o QR do pix alguns segundos
-- depois** de criar a cobrança. No instante da emissão ele ainda não existe;
-- segundos depois, existe — chamei o mesmo endpoint à mão e veio o payload
-- de 188 caracteres.
--
-- O DEFEITO NÃO ERA O PIX FALTAR, ERA ELE NUNCA MAIS SER BUSCADO.
--
-- `cobrancas_para_emitir` só devolve quem nunca foi emitido ou falhou — e
-- isso está certo, é a trava contra cobrar duas vezes. Mas significa que,
-- uma vez emitida, a cobrança sai de todas as filas para sempre. O boleto
-- funcionaria e o pix ficaria nulo até o fim dos tempos, sem erro nenhum.
-- O cliente abriria o portal e veria meia cobrança.
--
-- Eu já tinha escrito, na própria `cobrar-tick`, que se o pix falhasse era
-- melhor gravar assim mesmo do que deixar a cobrança órfã na Asaas. A
-- decisão continua certa; o que faltou foi a segunda metade dela — voltar
-- para buscar o que ficou para trás.
--
-- Daí esta fila separada. Ela não pode cobrar ninguém: só preenche um campo
-- de uma cobrança que já existe dos dois lados.
-- =============================================================================

create or replace function public.cobrancas_sem_pix(
  p_ambiente text default 'sandbox',
  p_limite   int default 50
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'lancamentoId', cb.lancamento_id,
           'externoId',    cb.externo_id)), '[]'::jsonb)
    from (select * from public.cobrancas
           where status = 'emitida'
             and externo_id is not null
             and pix_payload is null
             and ambiente = p_ambiente
             -- Depois de uma semana sem pix, o problema nao e demora da
             -- Asaas: e alguma coisa na conta, e insistir todo dia so gasta
             -- chamada. O boleto continua valendo.
             and emitida_em > now() - interval '7 days'
           order by emitida_em
           limit greatest(1, least(coalesce(p_limite, 50), 200))) cb;
$$;

revoke all on function public.cobrancas_sem_pix(text, int)
  from public, anon, authenticated;
grant execute on function public.cobrancas_sem_pix(text, int) to service_role;

-- ---------------------------------------------------------------------------
-- PREENCHER O PIX, e so o pix
--
-- Esta funcao nao muda status, nao mexe em valor, nao cria nada. Ela existe
-- para nao dar a quem busca o pix o poder de emitir cobranca.
-- ---------------------------------------------------------------------------
create or replace function public.cobranca_ganhou_pix(
  p_lancamento uuid,
  p_pix        text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_pix is null or length(btrim(p_pix)) = 0 then
    raise exception 'Pix vazio nao e pix.';
  end if;

  update public.cobrancas
     set pix_payload = btrim(p_pix)
   where lancamento_id = p_lancamento
     -- So preenche o que esta vazio. Reescrever o pix de uma cobranca que ja
     -- tem um trocaria o codigo que o cliente talvez ja tenha copiado.
     and pix_payload is null;

  if not found then
    raise exception 'Esta cobranca nao existe ou ja tem pix.';
  end if;
end;
$$;

revoke all on function public.cobranca_ganhou_pix(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cobranca_ganhou_pix(uuid, text) to service_role;
