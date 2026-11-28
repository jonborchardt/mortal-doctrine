import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The placeholder match's arena and skeleton textures are the Studio fixtures, served from
  // this app's own origin without copying them (until content packages exist, ticket #226).
  publicDir: '../studio/public',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
