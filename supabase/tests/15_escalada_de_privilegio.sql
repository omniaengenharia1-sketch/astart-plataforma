-- =============================================================================
-- O teste que nenhuma auditoria generica pega: nao basta a tabela ter RLS e ter
-- politica. A pergunta e o que a politica DEIXA fazer.
--
-- Politica de RLS e por LINHA. "Pode editar a propria linha" inclui a coluna
-- `papel` dessa linha — ou seja, incluia virar admin sozinho. Este arquivo
-- tenta todas as escaladas que me ocorreram, uma por uma.
-- =============================================================================
\set ON_ERROR_STOP on

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid
$$;
create or replace function public.afirma(p_ok boolean, p_oque text)
returns void language plpgsql as $$
begin if p_ok is not true then raise exception 'FALHOU: %', p_oque; end if; end $$;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'viviane@astartstudio.com.br'),
  ('10000000-0000-0000-0000-000000000002', 'layana@astartstudio.com.br'),
  ('20000000-0000-0000-0000-00000000000a', 'bruna@clientea.com.br');
insert into public.perfis (user_id, nome, papel, email, cargo) values
  ('10000000-0000-0000-0000-000000000001','Viviane','admin',   'viviane@astartstudio.com.br','Direção'),
  ('10000000-0000-0000-0000-000000000002','Layana', 'operacao','layana@astartstudio.com.br','Social Media');
insert into public.clientes (id, nome, slug) values
  ('a0000000-0000-0000-0000-00000000000a','Padaria Aurora','aurora'),
  ('b0000000-0000-0000-0000-00000000000b','Bloco B','bloco-b');
insert into public.clientes_usuarios (user_id, cliente_id, nome, email, papel_cliente) values
  ('20000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-00000000000a','Bruna',
   'bruna@clientea.com.br','leitura');

set role authenticated;

-- ---------------------------------------------------------------------------
-- 1. quem e da equipe, mas nao e admin
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000002';   -- operacao

do $$ begin
  begin
    update public.perfis set papel = 'admin' where user_id = auth.uid();
    raise exception 'FALHOU: operacao se promoveu a admin';
  exception when others then
    if position('Papel so quem administra' in sqlerrm) = 0 then raise; end if;
  end;
  perform public.afirma(not public.usuario_admin(), 'e continua nao sendo admin');

  begin
    update public.perfis set ativo = false where user_id = '10000000-0000-0000-0000-000000000001';
    -- Sem erro = o RLS nao deixou a linha nem aparecer; o efeito tem de ser zero.
    perform public.afirma(
      (select ativo from public.perfis where user_id = '10000000-0000-0000-0000-000000000001'),
      'operacao nao desativa o admin');
  exception when others then
    if position('administra a plataforma' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    update public.perfis set email = 'outro@astartstudio.com.br' where user_id = auth.uid();
    raise exception 'FALHOU: trocou o proprio e-mail de acesso';
  exception when others then
    if position('nao se trocam' in sqlerrm) = 0 then raise; end if;
  end;

  -- O que ela PODE: o proprio nome e o proprio cargo.
  update public.perfis set nome = 'Layana Alves', cargo = 'Social Media Sênior'
   where user_id = auth.uid();
  perform public.afirma(
    (select nome = 'Layana Alves' from public.perfis where user_id = auth.uid()),
    'mas muda o proprio nome, que e o motivo da politica existir');

  -- E nao cria perfil novo para ninguem.
  begin
    insert into public.perfis (user_id, nome, papel, email)
    values ('10000000-0000-0000-0000-00000000000f','Fantasma','admin','fantasma@x.com');
    raise exception 'FALHOU: operacao criou um perfil admin do nada';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 2. quem e cliente
-- ---------------------------------------------------------------------------
set "teste.uid" = '20000000-0000-0000-0000-00000000000a';

do $$ begin
  -- Virar equipe inserindo um perfil.
  begin
    insert into public.perfis (user_id, nome, papel, email)
    values (auth.uid(), 'Bruna', 'admin', 'bruna@clientea.com.br');
    raise exception 'FALHOU: um cliente criou perfil de equipe para si';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0
       and position('equipe' in sqlerrm) = 0 then raise; end if;
  end;

  -- Se ligar a si mesmo a outro cliente, le o outro cliente.
  begin
    insert into public.clientes_usuarios (user_id, cliente_id, nome, email)
    values (auth.uid(), 'b0000000-0000-0000-0000-00000000000b', 'Bruna', 'bruna@clientea.com.br');
    raise exception 'FALHOU: o cliente se deu acesso a outro cliente';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
  perform public.afirma(public.ficha_cliente('b0000000-0000-0000-0000-00000000000b') is null,
    'e segue sem ver o outro cliente');

  -- Subir de "so leitura" para "principal" no proprio cliente. Nao ha politica
  -- de UPDATE para ele, entao o comando nao da erro: simplesmente nao acha
  -- linha nenhuma para mexer. E e isso que o teste cobra.
  update public.clientes_usuarios set papel_cliente = 'principal' where user_id = auth.uid();
  perform public.afirma(
    (select papel_cliente from public.clientes_usuarios where user_id = auth.uid()) = 'leitura',
    'o cliente nao muda o proprio papel');

  -- Criar cliente novo para si.
  begin
    insert into public.clientes (nome, slug) values ('Cliente Fantasma','fantasma');
    raise exception 'FALHOU: o cliente cadastrou um cliente';
  exception when insufficient_privilege then null;
  when others then
    if position('row-level security' in sqlerrm) = 0 then raise; end if;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. o admin continua podendo o que precisa
-- ---------------------------------------------------------------------------
set "teste.uid" = '10000000-0000-0000-0000-000000000001';
do $$ begin
  update public.perfis set papel = 'financeiro'
   where user_id = '10000000-0000-0000-0000-000000000002';
  perform public.afirma(
    (select papel from public.perfis where user_id = '10000000-0000-0000-0000-000000000002')
      = 'financeiro',
    'o admin muda o papel de outra pessoa');
  perform public.desativar_pessoa('10000000-0000-0000-0000-000000000002');
  perform public.afirma(
    (select not ativo from public.perfis where user_id = '10000000-0000-0000-0000-000000000002'),
    'e desativa quem precisa');
end $$;

-- ---------------------------------------------------------------------------
-- 4. e o caminho da Edge Function (service_role, sem auth.uid) nao quebra
-- ---------------------------------------------------------------------------
reset role;
set "teste.uid" = '';
do $$ begin
  update public.perfis set ativo = true, desativado_em = null
   where user_id = '10000000-0000-0000-0000-000000000002';
  perform public.afirma(
    (select ativo from public.perfis where user_id = '10000000-0000-0000-0000-000000000002'),
    'service_role continua criando e arrumando perfil no aceite do convite');
end $$;

select 'escalada: tudo passou' as resultado;
