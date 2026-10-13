-- 0049 — desde quando a chave está lá. O diagnóstico que não depende da Meta.
--
-- A 0048 pergunta a saúde do token à própria Meta, com `debug_token`. Tem um
-- buraco que só apareceu quando a dona tentou de novo e levou o mesmo erro:
--
--   para perguntar à Meta, você precisa de um token VÁLIDO. Se o único token
--   que você tem é o que morreu, a pergunta morre com ele.
--
-- O `meta_app_id`/`meta_app_secret` resolvem isso — o app token não expira — e
-- entraram na 0048 justamente para isso. Mas eles são OPCIONAIS, e no caso
-- real eles não estavam cadastrados. Resultado: token morto, nenhuma
-- credencial de app, e a conferência voltava de mãos vazias. Exatamente na
-- situação em que ela mais importa.
--
-- O que ESTA migration adiciona é um diagnóstico que não pede nada à Meta:
-- **quando a chave foi cadastrada ou trocada.** É metadado do Vault, não o
-- valor. E resolve o caso mais comum sem uma única chamada de rede:
--
--   um token que a Meta recusa e que foi cadastrado há poucas horas é, quase
--   com certeza, um token curto do Graph API Explorer — porque token de
--   usuário do sistema NÃO EXPIRA. Nenhuma pergunta à Meta é necessária para
--   dizer isso.
--
-- Duas coisas, e as duas de propósito:
--
--   1. `estado_dos_conectores()` passa a devolver `atualizadaEm` por chave de
--      Vault, para a tela de Integrações poder dizer "cadastrada há 11 horas"
--      em vez de só `●`. Data não é segredo, e esta é a informação que
--      transforma "está lá" em "está lá desde quando".
--
--   2. `quando_a_chave_mudou()`, para a Edge Function montar o diagnóstico
--      degradado. Só service_role, como as outras funções que encostam no
--      Vault — mesmo não devolvendo valor nenhum. A regra aqui não abre
--      exceção por conveniência: função com `vault` no `search_path` é
--      service_role, e quem quiser a data pelo navegador usa a de cima, que
--      já passa pelo portão de admin.

-- ---------------------------------------------------------------------------
-- 1. A data, para a Edge Function
-- ---------------------------------------------------------------------------
create or replace function public.quando_a_chave_mudou(p_nome text)
returns timestamptz
language sql
stable
security definer
set search_path = public, vault, pg_temp
as $$
  select greatest(s.updated_at, s.created_at)
    from vault.secrets s
   where s.name = p_nome
   limit 1;
$$;

revoke all on function public.quando_a_chave_mudou(text) from public, anon, authenticated;
grant execute on function public.quando_a_chave_mudou(text) to service_role;

comment on function public.quando_a_chave_mudou(text) is
  'Quando a chave do Vault foi cadastrada ou trocada. Metadado, nunca o valor.';

-- ---------------------------------------------------------------------------
-- 2. A mesma data na tela de Integrações
--
-- O corpo inteiro é repetido porque `create or replace function` não aceita
-- remendo — e isto é bom: a versão nova fica legível por inteiro no histórico,
-- em vez de só um diff de uma linha dentro de um jsonb aninhado.
-- ---------------------------------------------------------------------------
create or replace function public.estado_dos_conectores()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, extensions, pg_temp
as $$
declare
  v_resposta jsonb;
begin
  -- Admin, e só. O que está aqui não é segredo, mas é o mapa de onde os
  -- segredos ficam e do que falta — leitura de direção, não de operação.
  if not public.usuario_admin() then
    return null;
  end if;

  select jsonb_agg(linha order by (linha->>'ordem')::int)
    into v_resposta
    from (
      select jsonb_build_object(
               'id',         i.id,
               'nome',       i.nome,
               'paraQue',    i.para_que,
               'construida', i.construida,
               'ordem',      i.ordem,
               'chaves',     (
                 select jsonb_agg(
                          jsonb_build_object(
                            'chave',       k.chave,
                            'onde',        k.onde,
                            'obrigatoria', k.obrigatoria,
                            'paraQue',     k.para_que,
                            -- Presença, nunca valor. `vault.secrets` guarda o
                            -- nome; a descriptografia nem acontece.
                            'presente',    case
                                             when k.onde = 'funcao' then null
                                             else exists (
                                               select 1 from vault.secrets s where s.name = k.chave
                                             )
                                           end,
                            -- Desde quando. Data não é segredo, e é o que
                            -- separa "está lá" de "está lá desde quando" —
                            -- chave trocada hoje e já recusada pela Meta conta
                            -- uma história que o `●` sozinho não conta.
                            'atualizadaEm', case
                                              when k.onde = 'funcao' then null
                                              else (
                                                select greatest(s.updated_at, s.created_at)
                                                  from vault.secrets s where s.name = k.chave
                                                 limit 1
                                              )
                                            end
                          )
                          order by k.onde desc, k.obrigatoria desc, k.chave
                        )
                   from public.conector_chaves k
                  where k.conector_id = i.id
               ),
               'faltando', (
                 select coalesce(jsonb_agg(k.chave order by k.chave), '[]'::jsonb)
                   from public.conector_chaves k
                  where k.conector_id = i.id
                    and k.obrigatoria
                    and k.onde = 'vault'
                    and not exists (select 1 from vault.secrets s where s.name = k.chave)
               ),
               'agendador', case
                 when i.id <> 'meta' then null
                 else jsonb_build_object(
                        'publicar', exists (select 1 from cron.job j where j.jobname = 'publicar-tick'),
                        'renovar',  exists (select 1 from cron.job j where j.jobname = 'renovar-tokens')
                      )
               end
             ) as linha
        from public.conectores i
    ) t;

  return coalesce(v_resposta, '[]'::jsonb);
exception
  -- `cron` não existe em todo ambiente, e a tela não pode morrer por isso: ela
  -- existe justamente para dizer o que está faltando.
  when undefined_table or invalid_schema_name then
    return v_resposta;
end;
$$;

revoke all on function public.estado_dos_conectores() from public, anon;
grant execute on function public.estado_dos_conectores() to authenticated, service_role;
