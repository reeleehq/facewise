import { defineConfig } from 'vite';
export default defineConfig({ root: 'e2e/harness', server: { port: 4321, strictPort: true } });
