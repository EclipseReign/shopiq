import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL || 'http://127.0.0.1:5000';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': backend } },
  preview: { host: '127.0.0.1', port: 3000, strictPort: true, proxy: { '/api': backend } },
  build: { target: 'es2022', sourcemap: false },
});
