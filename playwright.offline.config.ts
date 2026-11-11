import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// オフライン（Service Worker）の確認はビルド済みアプリが必要（SW は本番ビルドでだけ登録される）。
const chrome = process.env.PW_CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
const PORT = 4199;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/offline.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...(chrome ? { launchOptions: { executablePath: chrome } } : {}),
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
