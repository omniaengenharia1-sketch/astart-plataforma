-- 0054 — o caminho do arquivo do relatório, para a tela conseguir abri-lo.
--
-- A `campanhas_do_cliente()` da 0036 devolve `'arquivo', r.arquivo_nome`: o
-- NOME do arquivo, não o caminho no bucket. Serve para escrever "Setembro
-- 2026.pdf" na tela e para nada mais — sem o caminho, o front não tem como
-- pedir uma URL assinada, e o relatório fica sendo um texto que ninguém abre.
--
-- Passou despercebido até agora porque ninguém nunca conseguiu ANEXAR um
-- relatório: a tabela não tinha escritor (a 0053 resolveu) e não havia bucket.
-- Leitura sem escrita nunca é exercitada de verdade, e o que não é exercitado
-- não mostra o que falta. É a mesma razão por que `contas_sociais` ficou com
-- um campo inútil por semanas.
--
-- O nome CONTINUA sendo devolvido, e não é redundância: é ele que aparece na
-- tela. O caminho é o endereço no bucket, que é feio e não interessa a quem
-- lê — serve para a URL assinada e nada mais.

create or replace function public.campanhas_do_cliente(p_cliente uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when not public.usuario_ve_cliente(p_cliente)
      or not public.cliente_tem_modulo(p_cliente, 'campanhas') then null::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'de', r.periodo_inicio,
        'ate', r.periodo_fim,
        'arquivo', r.arquivo_nome,
        -- O que faltava: sem ele a tela não assina URL e o relatório não abre.
        'arquivoCaminho', r.arquivo_caminho,
        'metricas', coalesce((
          select jsonb_agg(jsonb_build_object('rotulo', m.rotulo, 'valor', m.valor) order by m.ordem)
          from public.relatorio_metricas m where m.relatorio_id = r.id), '[]'::jsonb),
        'campanhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'nome', ca.nome, 'plataforma', ca.plataforma, 'objetivo', ca.objetivo,
            'verbaCentavos', ca.verba_centavos,
            'resultadoRotulo', ca.resultado_rotulo, 'resultadoValor', ca.resultado_valor)
            order by ca.nome)
          from public.campanhas ca where ca.relatorio_id = r.id), '[]'::jsonb))
        order by r.periodo_inicio desc)
      from public.relatorios_campanha r
     where r.cliente_id = p_cliente), '[]'::jsonb)
  end;
$$;
