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
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
});
