import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/oauth2callback': 'http://localhost:3000'
    }
  },
  build: {
    outDir: resolve(__dirname, '../public'),
    emptyOutDir: true,
    assetsDir: 'assets'
  }
});
