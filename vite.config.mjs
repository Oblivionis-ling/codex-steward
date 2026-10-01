import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'plugins/personal-steward/dist/ui', emptyOutDir: true, target: 'es2022' },
});
