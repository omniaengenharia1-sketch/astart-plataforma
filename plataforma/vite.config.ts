import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Sem acoplamento a Vercel ou Netlify: build estático puro em dist/.
//
// base relativo: assim o mesmo dist/ abre na raiz de um domínio, numa subpasta
// ou numa prévia hospedada em qualquer lugar, sem rebuild.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
});
