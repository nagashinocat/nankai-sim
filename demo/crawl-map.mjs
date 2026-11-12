import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import presets from './presets.json' with { type: 'json' };
const srv = spawn('python3', ['-m', 'http.server', '5288', '-d', 'dist-demo'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
const used = new Set(); const external = new Set(); const errors = [];
for (const [i, p] of presets.entries()) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/*', (r) => {
    const u = r.request().url();
    if (!u.startsWith('http://localhost:5288/')) { external.add(new URL(u).host); return r.abort(); }
    if (u.includes('/data/')) used.add(u.split('/data/')[1]);
    return r.continue();
  });
  await page.goto('http://localhost:5288/index.html');
  await page.getByLabel('住所').fill(p.label.slice(3, 8));
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  const cand = page.getByRole('button', { name: p.label });
  if (await cand.count()) await cand.click();
  await page.getByText(/震度\d/).first().waitFor({ timeout: 30000 });
  for (const t of await page.locator('.tab').all()) { await t.click(); await page.waitForTimeout(1500); }
  await page.locator('.map').first().screenshot({ path: `demo/map-${i}.png` });
  const txt = await page.locator('#home-result').innerText().catch(() => '');
  console.log('==', p.label, '|', txt.replace(/\n/g, ' ').slice(0, 160));
  await page.close();
}
await browser.close(); srv.kill();
console.log('external', [...external]); console.log('errors', errors);
(await import('node:fs')).writeFileSync('demo/used.json', JSON.stringify([...used].sort()));
console.log('used', used.size);
