-- 0042 — o que o linter do Supabase achou, e que os meus testes não achavam.
--
-- Duas coisas, e as duas vinham desde as primeiras migrations. Nenhuma apareceu
-- em 22 testes porque os testes cobravam COMPORTAMENTO — "o cliente errado não
-- lê" — e estas são propriedades da declaração da função. Comportamento certo
-- com declaração frouxa passa em teste de comportamento.
--
-- Por isso o teste 23 não repete o que estas linhas fazem: ele cobra a
-- propriedade em TODAS as funções, inclusive nas que ainda não existem.

-- ---------------------------------------------------------------------------
-- 1. search_path fixo nas cinco que ficaram sem.
--
-- Estas cinco são SECURITY INVOKER — rodam como quem chama, então o estrago
-- possível é muito menor que nas DEFINER, e é honesto dizer isso. O motivo de
-- consertar não é um ataque que eu saiba demonstrar: é que a regra do projeto
-- não admite exceção silenciosa. Uma função de gatilho sem search_path resolve
-- `now()` e `jsonb_set` por um caminho que o chamador escolhe, e o dia em que
-- uma delas virar SECURITY DEFINER — porque alguém precisou — a brecha nasce
-- pronta, sem ninguém lembrar de olhar aqui.
--
-- `alter function` em vez de reescrever o corpo: o corpo está certo, e trocar
-- 40 linhas de SQL para mudar uma propriedade é convite a erro de digitação.
-- ---------------------------------------------------------------------------
alter function public.tg_set_atualizado_em()      set search_path = public, extensions, pg_temp;
alter function public.tg_redigir_payload()        set search_path = public, extensions, pg_temp;
alter function public.tg_bloquear_mutacao()       set search_path = public, extensions, pg_temp;
alter function public.tg_perfil_desativado_em()   set search_path = public, extensions, pg_temp;
alter function public.redigir_segredos(jsonb)     set search_path = public, extensions, pg_temp;

-- ---------------------------------------------------------------------------
-- 2. As três funções do link de galeria param de ser chamáveis pelo navegador.
--
-- Elas nasceram com execute para `anon`, e a intenção era boa: quem abre um
-- link de galeria não tem conta, então `anon` precisa alcançar alguma coisa.
-- Só que o desenho mudou e a permissão ficou. Hoje quem chama estas três é a
-- Edge Function `galeria`, com service_role — está escrito no
-- docs/arquitetura.md: "Quem lê é service_role, ou seja a Edge Function".
--
-- Com execute para `anon`, o mesmo token podia ser gasto direto em
-- /rest/v1/rpc/galeria_por_token, sem passar pela função. Não era cofre aberto
-- — o token continua conferido contra o hash, e token errado não devolve nada.
-- Era uma segunda porta para o mesmo cofre, sem ninguém olhando: a Edge
-- Function é onde ficam o registro de acesso e o controle de quantas tentativas
-- uma pessoa faz. Duas portas e um vigia é o tipo de arranjo que ninguém
-- desenha de propósito.
--
-- `authenticated` perde junto, e pelo mesmo motivo: quem está logado tem
-- `favoritar_item` e `usuario_ve_galeria`, que decidem pelo RLS em vez de por
-- token. Ninguém logado precisa da porta de quem não tem conta.
-- ---------------------------------------------------------------------------
revoke execute on function public.galeria_por_token(text) from anon, authenticated;
revoke execute on function public.favoritar_por_token(text, uuid, text, boolean) from anon, authenticated;
revoke execute on function public.registrar_download_galeria(text, uuid, text) from anon, authenticated;

-- E explícito, não por sobra: é service_role quem chama.
grant execute on function public.galeria_por_token(text) to service_role;
grant execute on function public.favoritar_por_token(text, uuid, text, boolean) to service_role;
grant execute on function public.registrar_download_galeria(text, uuid, text) to service_role;
