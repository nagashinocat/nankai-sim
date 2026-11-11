import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// 同梱ブラウザが無い環境向け: PW_CHROME で実行ファイルを指定できる。
const chrome = process.env.PW_CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  testIgnore: '**/offline.spec.ts', // ビルド済みアプリが必要。playwright.offline.config.ts で実行する
  timeout: 60_000,
  use: {
    channel: undefined,
    baseURL: 'http://localhost:5199',
    ...(chrome ? { launchOptions: { executablePath: chrome } } : {}),
  },
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
