import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/helpers/limite-d1.ts'],
    // The SDK's extensionless Next imports must use Vite's resolver in offline tests.
    server: { deps: { inline: ['@neondatabase/auth'] } },
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
