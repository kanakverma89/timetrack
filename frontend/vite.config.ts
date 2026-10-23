import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Shared repo-root .env supplies VITE_* values; only VITE_-prefixed keys are ever exposed.
  const env = loadEnv(mode, '..', 'VITE_');
  return {
    envDir: '..',
    plugins: [react()],
    server: {
      port: Number(process.env.PORT ?? 5173),
      strictPort: true,
      proxy: {
        // Same-origin in development so the HttpOnly session cookie needs no CORS tricks.
        '/api': {
          target: process.env.VITE_PROXY_TARGET ?? env.VITE_PROXY_TARGET ?? 'http://localhost:8000',
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
