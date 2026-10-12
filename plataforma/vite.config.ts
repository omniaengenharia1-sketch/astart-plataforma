import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Sem acoplamento a Vercel ou Netlify: build estático puro em dist/.
//
// O `base` muda com o alvo, e o motivo é concreto:
//
//   - Em produção precisa ser '/'. Com base relativo, abrir /clientes/abc
//     direto (ou só apertar F5 ali) faz o navegador pedir os arquivos em
//     /clientes/assets/… — 404, tela branca. Só não aparece navegando por
//     cliques, que é como os roteiros andavam.
//   - Na prévia estática precisa ser './', porque ela é servida de um caminho
//     qualquer. Lá a rota é por #, então o caminho nunca fica mais fundo.
const previa = process.env['VITE_PREVIA'] === '1';

export default defineConfig({
  base: previa ? './' : '/',
  // A prévia é uma demonstração, e demonstração NÃO fala com o banco de
  // verdade. Sem isto, um `.env.local` na máquina de quem builda a prévia
  // publicaria uma página que escreve na conta do cliente — e quem abrisse o
  // link acharia que está mexendo em dados fictícios.
  //
  // `define` sobrescreve o que o .env tiver: o modo exemplo vira garantia de
  // build, não disciplina de quem roda o comando.
  ...(previa
    ? {
        define: {
          'import.meta.env.VITE_SUPABASE_URL': 'undefined',
          'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': 'undefined',
          'import.meta.env.VITE_SUPABASE_ANON_KEY': 'undefined',
        },
      }
    : {}),
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
});
