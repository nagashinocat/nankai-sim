import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

// 「ひと目でわかる」の絵（震度バッジ・10軒の家・幅の横棒・津波の絵・まとめ）。390×844 の画面写しを reports/visual-*.png に残す。
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const KOMONO = { lat: 35.02, lon: 136.5072 };
const hasRealData = fs.existsSync('public/data/manifest.json') && fs.existsSync('public/data/tsunami_arrival.json');
const gsiHit = (title: string, lat: number, lon: number) => ({
  geometry: { coordinates: [lon, lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title },
});

test.beforeEach(async ({ page }) => {
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
  await stubTsunami(page);
});

async function search(page: Page, at: { lat: number; lon: number }, title: string, wood = false) {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [gsiHit(title, at.lat, at.lon)] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill(title);
  if (wood) {
    await page.getByLabel('建築年').selectOption('pre1981');
    await page.getByLabel('構造').selectOption('wood');
  }
  await page.getByRole('button', { name: '調べる' }).click();
  await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
}

test('見た目: 震度バッジ・10軒の家・幅の横棒・津波の絵・まとめ（浸水深1〜3m）', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, YOKKAICHI, '四日市市', true);
  const home = page.locator('#home-result');
  // 震度は色の札。文字はそのまま
  await expect(home.locator('.shindo')).toHaveCount(1);
  await expect(home.locator('.shindo')).toHaveText(/^震度(7|6強|6弱|5強|5弱|4|3以下)$/);
  // 10軒の家と一文、幅の横棒（読み上げの名前つき）
  await expect(home.locator('.house-icons svg')).toHaveCount(10);
  await expect(home.locator('.house-caption')).toHaveText(/^10軒あったら：全壊 (約\d+軒|1軒未満)・半壊 (約\d+軒|1軒未満)$/);
  await expect(home.getByRole('img', { name: /^全壊 代表値.+% 幅.+〜.+$/ })).toHaveCount(1);
  await expect(home.getByRole('img', { name: /^半壊 代表値.+% 幅.+〜.+$/ })).toHaveCount(1);
  // 津波の絵と言いかえ
  await expect(home.getByRole('img', { name: /津波の深さの絵：浸水深 1〜3m（想定）。1階の天井近くまで/ })).toBeVisible();
  await expect(home.locator('.tsunami-picture figcaption')).toHaveText('1階の天井近くまで（想定 1〜3m）');
  // 見出しの名前は変わらない（絵文字は読み上げない）
  await expect(page.getByRole('heading', { name: '自宅の結果', exact: true })).toBeVisible();
  await expect(home.getByRole('heading', { name: '津波', exact: true })).toBeVisible();
  // まとめ
  const sum = page.locator('#summary');
  await expect(sum.getByRole('heading', { name: 'ひと目でわかる' })).toBeVisible();
  await expect(sum.locator('.tile')).toHaveCount(4);
  await expect(sum.locator('.tile-tsunami')).toContainText('浸水深 1〜3m');
  await expect(sum.locator('.tile-tsunami .tile-note')).toHaveText('揺れたらすぐ高い所へ');
  await expect(sum.locator('.tile-arrival')).toContainText('最短約15分（目安）');
  // まとめはタブの説明・注意の下、自宅の結果の上
  expect(await page.evaluate(() => {
    const [ex, sm, hm] = ['.scenario-explain', '#summary', '#home-result'].map((q) => document.querySelector(q)!);
    const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    return after(ex, sm) && after(sm, hm);
  })).toBe(true);
  // 絵は津波の文の全部の後
  expect(await home.evaluate((h) => {
    const kids = [...h.children];
    const pic = kids.findIndex((k) => k.classList.contains('tsunami-picture'));
    return kids.slice(pic + 1).some((k) => /tsunami|note/.test(k.className) && /津波|到達|高い所/.test(k.textContent ?? ''));
  })).toBe(false);
  // 横棒の幅の帯と、枠の内側の印
  await expect(home.locator('.house-key')).toContainText('それ以外（被害なしとは限りません）');
  await page.locator('#summary').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/visual-summary-390x844.png' });
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/visual-home-390x844.png' });
  await home.locator('.tsunami-picture').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'reports/visual-tsunami-390x844.png' });
});

test('見た目: 10m以上は全体を水にして「家より高い」', async ({ page }) => {
  await stubTsunami(page, { rgb: [242, 133, 201] });
  await search(page, YOKKAICHI, '四日市市');
  const home = page.locator('#home-result');
  await expect(home.locator('.tsunami-picture figcaption')).toHaveText('家が完全に沈む高さ（想定 10〜20m・家より高い）');
  await expect(home.locator('.tsunami-picture svg text', { hasText: '家より高い' })).toHaveCount(1);
  await expect(home.locator('.tsunami-picture .water-band')).toHaveCount(0); // 上限まで水
  await home.locator('.tsunami-picture').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'reports/visual-tsunami-deep-390x844.png' });
});

test('見た目: 自宅の点は浸水域外で近くに浸水 → 「近くで」の言いかえ', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 183, 183], hole: { ...YOKKAICHI, radiusPx: 20 } });
  await search(page, YOKKAICHI, '四日市市');
  const home = page.locator('#home-result');
  await expect(home.locator('.tsunami-picture figcaption')).toHaveText('近くで2階の床より上（想定 3〜5m）');
  await expect(home.locator('.tsunami-picture svg text', { hasText: '近く（自宅の地点は浸水域外）' })).toHaveCount(1);
  // 水は右側だけ（家の左端より右から始まる）
  const wx = Number(await home.locator('.tsunami-picture .water-mid').getAttribute('x'));
  expect(wx).toBeGreaterThan(150);
  await home.locator('.tsunami-picture').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'reports/visual-tsunami-nearby-390x844.png' });
  await expect(home.getByRole('img', { name: /すぐ近く（約50m以内）の浸水深 3〜5m/ })).toBeVisible();
  await expect(page.locator('#summary .tile-tsunami')).toContainText('近くで 最大3〜5m');
});

test('見た目: 浸水域外では津波の絵も到達の札も出さない', async ({ page }) => {
  await search(page, YOKKAICHI, '四日市市');
  await expect(page.locator('.tsunami-picture')).toHaveCount(0);
  await expect(page.locator('#summary .tile')).toHaveCount(3);
  await expect(page.locator('#summary .tile-tsunami')).toContainText('想定の浸水域外');
});

test('見た目: 時間差のタブは震度の札が2つ、家の列が2段（先発・合計）。まとめもタブに合わせて変わる', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await search(page, KOMONO, '菰野町吉澤', true);
  const sum = page.locator('#summary');
  await expect(sum.locator('.tile-shake')).toContainText('揺れ');
  await page.getByRole('tab', { name: '時間差（東→西）', exact: true }).click();
  const home = page.locator('#home-result');
  await expect(home.getByRole('heading', { name: '先発（東側）' })).toBeVisible();
  await expect(home.locator('.shindo-line .shindo')).toHaveCount(2);
  await expect(home.locator('.house-icons')).toHaveCount(2);
  await expect(home.locator('.range-bar')).toHaveCount(4);
  await expect(sum.locator('.tile-shake .tile-label')).toHaveText('揺れ（強いほう）');
  await expect(sum.locator('.tile-collapse .tile-label')).toHaveText('自宅の全壊（合計）');
  await page.getByRole('tablist').evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/visual-lag-390x844.png' });
  await home.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/visual-lag-home-390x844.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('再生: 地震から津波まで（動きを減らす設定では「次へ」で進める）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, YOKKAICHI, '四日市市', true);
  const open = page.getByRole('button', { name: '▶ 地震から津波までを再生' });
  // 「ひと目でわかる」の下
  expect(await page.evaluate(() => {
    const a = document.querySelector('#summary')!, b = document.querySelector('#player-open')!;
    return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  })).toBe(true);
  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  const player = page.locator('#player');
  const caption = player.locator('#player-caption');
  await expect(player.locator('.player-clock')).toHaveText('地震発生から 0分00秒');
  await expect(caption).toHaveText('強い揺れが長く続きます（南海トラフでは数分）。まず身を守る');
  await expect(player.locator('#player-live')).toHaveAttribute('aria-live', 'polite');
  await expect(player.locator('#player-live #player-caption')).toHaveCount(1);
  await expect(player.locator('svg text', { hasText: '模式図（位置や距離は実際と異なります）' })).toHaveCount(1);
  await expect(player.locator('.player-badge .shindo')).toHaveCount(1);
  // 動かさない（再生ボタンは無く「次へ」）
  await expect(player.getByRole('button', { name: '再生' })).toHaveCount(0);
  await player.scrollIntoViewIfNeeded();
  await player.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/player-shake-390x844.png' });
  const next = player.getByRole('button', { name: '次へ' });
  await next.click();
  await expect(caption).toHaveText('揺れが収まったらすぐ高い所へ');
  await expect(player.locator('.player-clock')).toHaveText('地震発生から 5分00秒');
  await expect(player.locator('.player-info')).toContainText(/徒歩 約\d+分/);
  await page.screenshot({ path: 'reports/player-evac-390x844.png' });
  await next.click();
  await expect(caption).toHaveText(/^最短約15分で海岸に津波/);
  await expect(player.locator('.player-countdown')).toHaveText('海岸に津波が到達');
  await page.screenshot({ path: 'reports/player-arrival-390x844.png' });
  await next.click();
  await expect(caption).toHaveText(/^自宅のあたりの浸水（想定 1〜3m/);
  await expect(player.getByRole('img', { name: /津波の深さの絵/ })).toBeVisible();
  await page.screenshot({ path: 'reports/player-water-390x844.png' });
  await next.click();
  await expect(player.locator('.end-strong')).toHaveText('到達時間を待たずに、すぐ高い所へ');
  await expect(player.getByText('これは想定をもとにした目安の再現です')).toBeVisible();
  await expect(player.getByText(/^海岸に津波：最短約15分$/)).toBeVisible();
  await expect(player.getByText(/^避難場所に着く：約\d+分（揺れが収まってから歩いた場合）$/)).toBeVisible();
  // 判定は避難場所リストと同じ（リストが △ ぎりぎり なら黄、× なら赤）
  await expect(page.locator('#evac .reach').first()).toContainText('ぎりぎり');
  await expect(player.locator('.end-tight')).toHaveText('ぎりぎり：迷わずすぐ。より近い高い場所も考えて');
  await expect(player.locator('.end-late-card')).toHaveCount(0);
  await expect(next).toBeDisabled();
  await player.locator('.player-end').evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: 'reports/player-end-390x844.png' });
  // 場面の一覧（ボタン）で戻れる
  await player.getByRole('button', { name: '1. 揺れ' }).click();
  await expect(caption).toHaveText(/^強い揺れが長く続きます/);
  await expect(player.getByRole('button', { name: '1. 揺れ' })).toHaveAttribute('aria-current', 'step');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await player.getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('#player')).toHaveCount(0);
  await expect(open).toBeFocused();
});

test('再生: アニメーションの時計が進み、タブを替えると止まって閉じる', async ({ page }) => {
  await stubTsunami(page, { rgb: [255, 216, 192] });
  await search(page, YOKKAICHI, '四日市市');
  await page.getByRole('button', { name: '▶ 地震から津波までを再生' }).click();
  const player = page.locator('#player');
  await expect(player.locator('.player-clock')).not.toHaveText('地震発生から 0分00秒');
  await expect(player.locator('.player-countdown')).toHaveText(/海岸に津波まで 最短あと約\d+分/);
  await player.getByRole('button', { name: '一時停止' }).click();
  const a = await player.locator('.player-clock').textContent();
  await page.waitForTimeout(400);
  expect(await player.locator('.player-clock').textContent()).toBe(a);
  await player.getByRole('button', { name: '再生' }).click();
  await expect(player.locator('.player-clock')).not.toHaveText(a!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('tab', { name: '東側の半割れ', exact: true }).click();
  await expect(page.locator('#player')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '▶ 地震から津波までを再生' })).toHaveAttribute('aria-expanded', 'false');
});

test('再生: 時間差のタブは先発の揺れ→後発までの間→後発の揺れ', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await search(page, KOMONO, '菰野町吉澤', true);
  await page.getByRole('tab', { name: '時間差（東→西）', exact: true }).click();
  await expect(page.locator('#home-result').getByRole('heading', { name: '先発（東側）' })).toBeVisible();
  await page.getByRole('button', { name: '▶ 地震から津波までを再生' }).click();
  const player = page.locator('#player');
  await expect(player.locator('.player-clock')).toHaveText('先発の地震から 0分00秒');
  await player.getByRole('button', { name: '次へ' }).click();
  await expect(player.locator('#player-caption')).toHaveText(/^先発の地震でも津波が来ることがあります/);
  await expect(player.locator('.player-clock')).toHaveText('先発の地震から 5分00秒');
  await player.getByRole('button', { name: '次へ' }).click();
  await expect(player.locator('#player-caption')).toHaveText('後発の地震：数時間後〜数年後かもしれません（わからない）');
  await player.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/player-lag-gap-390x844.png' });
  await player.getByRole('button', { name: '次へ' }).click();
  await expect(player.locator('.player-clock')).toHaveText('後発の地震発生から 0分00秒');
  await player.getByRole('button', { name: /^\d+\. まとめ$/ }).click();
  await expect(player.locator('.end-strong')).toHaveText('到達時間を待たずに、すぐ高い所へ');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('再生: 間に合わないおそれのときは、人を到達時刻の位置で止め、場面に赤で出す', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await stubTsunami(page, { rgb: [255, 216, 192] });
  // 津波の避難場所を約1.5km先の1か所だけにする（ゆっくり歩くと約65分）
  await page.route('**/data/shelters/*.json', (r) => r.fulfill({ json: [
    { id: 'T1', name: 'テスト高台', pos: { lat: YOKKAICHI.lat + 0.0135, lon: YOKKAICHI.lon }, earthquake: true, tsunami: true },
  ] }));
  await search(page, YOKKAICHI, '四日市市');
  await expect(page.locator('#evac .reach').first()).toContainText('間に合わないおそれ');
  await page.getByRole('button', { name: '▶ 地震から津波までを再生' }).click();
  const player = page.locator('#player');
  const late = player.locator('.player-late');
  await expect(late).toBeHidden();
  await player.getByRole('button', { name: '3. 津波が海岸に' }).click();
  await expect(late).toBeVisible();
  await expect(late).toHaveText('間に合わないおそれ：近くの高い建物（津波避難ビル）や高台へ');
  const personX = () => player.locator('.player-stage > g').nth(1).locator('> g').last().getAttribute('transform');
  const atArrival = await personX();
  await player.getByRole('button', { name: '4. 浸水' }).click();
  await expect(late).toBeVisible();
  expect(await personX()).toBe(atArrival);
  // 避難場所（左端）まで着いていない
  const x = Number(/translate\(([\d.]+)/.exec(atArrival!)![1]);
  expect(x).toBeGreaterThan(80);
  await player.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: 'reports/player-late-390x844.png' });
  await player.getByRole('button', { name: '5. まとめ' }).click();
  await expect(player.locator('.end-late-card')).toBeVisible();
  await expect(late).toBeHidden();
  expect(await personX()).toBe(atArrival);
});
