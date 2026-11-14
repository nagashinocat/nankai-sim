import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { stubTsunami } from './tsunami-stub.ts';

const hasRealData = fs.existsSync('public/data/manifest.json') && fs.existsSync('public/data/tsunami_arrival.json');
const YOKKAICHI = { lat: 34.9667, lon: 136.6247 };
const KOMONO = { lat: 35.02, lon: 136.5072 };
/** 海側（この経度より東）だけ浸水 1〜3m。四日市の自宅は浸水域内 */
const COAST = { rgb: [255, 216, 192] as [number, number, number], floodEastOf: 136.618 };
const ESCAPE_RE = /^近い津波の避難場所「\d」：(北|北東|東|南東|南|南西|西|北西)に約[\d.]+k?m（直線）。海から離れる方向とは限りません。道と方向は実際に確かめてください$/;

async function search(page: Page, at: { lat: number; lon: number }, title: string, wait = true): Promise<void> {
  await page.route('**/msearch.gsi.go.jp/**', (r) => r.fulfill({ json: [{ geometry: { coordinates: [at.lon, at.lat], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title } }] }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('住所').fill(title);
  await page.getByLabel('建築年').selectOption('pre1981');
  await page.getByLabel('構造').selectOption('wood');
  await page.getByRole('button', { name: '調べる' }).click();
  if (wait) await expect(page.locator('#home-result').getByText(/震度\d/)).toBeVisible({ timeout: 30_000 });
}

const legendTitles = (page: Page) => page.locator('#risk-legend li strong').allInnerTexts();
const noOverflow = async (page: Page) => {
  const w = await page.evaluate(() => document.scrollingElement!.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
};

test.beforeEach(async ({ page }) => {
  // 地図の下地（地理院タイル）は読めない（電波なしと同じ）。マス・印・矢印・凡例は手元で描く
  await page.route('**/cyberjapandata.gsi.go.jp/**', (r) => r.abort());
});

test('やることマップ: 揺れ／津波／両方の切りかえで凡例・読み上げ・自宅はここ が変わり、タブを変えても選んだ表示が残る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI, '四日市市');
  const btn = (m: string) => page.locator(`#risk-mode-${m}`);
  await expect(page.getByRole('group', { name: '地図の表示' })).toBeVisible();
  // 既定は両方
  await expect(btn('both')).toHaveAttribute('aria-pressed', 'true');
  await expect(btn('shake')).toHaveAttribute('aria-pressed', 'false');
  expect(await legendTitles(page)).toEqual(expect.arrayContaining(['津波の避難場所（高い所・建物の上の階）', '地震の避難場所', '両方に注意', 'すぐ高い所へ', '家の倒壊に注意', '比較的低い']));
  await expect(page.locator('#result-map')).toHaveAttribute('aria-label', /^揺れと津波の両方の地図。自宅は /);
  await expect(page.locator('#risk-home .rm-home-k')).toHaveText('自宅はここ');
  await expect(page.locator('#risk-home .rm-home-note')).toHaveText('入力した家の推計です。マスの色は地域の平均です');
  await expect(page.locator('#risk-panel')).toContainText('マスの色はマスの中心の想定、自宅の判定は自宅の地点の想定です');
  await expect(page.locator('#risk-scenario-note')).toBeHidden();
  const bothTitle = await page.locator('#risk-home .rm-home-title').innerText();
  expect(['両方に注意', 'すぐ高い所へ']).toContain(bothTitle);
  // 地理院の津波タイルは「津波」のときだけ
  await expect(page.locator('#result-map img[src*="04_tsunami_newlegend_data"]')).toHaveCount(0);

  await btn('shake').click();
  await expect(btn('shake')).toHaveAttribute('aria-pressed', 'true');
  await expect(btn('both')).toHaveAttribute('aria-pressed', 'false');
  expect((await legendTitles(page)).slice(2)).toEqual(['倒壊の危険 大', '倒壊の危険 中', '比較的低い']);
  await expect(page.locator('#result-map')).toHaveAttribute('aria-label', /^揺れの地図。/);
  await expect(page.locator('#risk-home .rm-home-title')).toHaveText(/^倒壊の危険|比較的低い/);
  // 揺れでは矢印を出さない
  await expect(page.locator('#result-map .rm-arrow')).toHaveCount(0);
  await expect(page.locator('#risk-escape-text')).toHaveCount(0);

  await btn('tsunami').click();
  expect((await legendTitles(page)).slice(2, 4)).toEqual(['津波の浸水想定', '想定なし']);
  await expect(page.locator('#result-map')).toHaveAttribute('aria-label', /^津波の地図。/);
  await expect(page.locator('#risk-home .rm-home-title')).toHaveText('すぐ高い所へ');
  await expect(page.locator('.tsunami-legend li')).toHaveCount(8);
  await expect(page.locator('#result-map img[src*="04_tsunami_newlegend_data"]').first()).toBeAttached();

  // タブを変えても「津波」のまま
  await page.getByRole('tab', { name: '東側の半割れ', exact: true }).click();
  await expect(page.locator('#case-line')).toContainText('東側の半割れ');
  await expect(btn('tsunami')).toHaveAttribute('aria-pressed', 'true');
  // 半割れ・時間差でも津波のマスは最大クラスの想定、と書く
  await expect(page.locator('#risk-scenario-note')).toBeVisible();
  await expect(page.locator('#risk-scenario-note')).toContainText('最大クラスの想定');
  expect((await legendTitles(page)).slice(2, 4)).toEqual(['津波の浸水想定', '想定なし']);
  await expect(page.locator('#risk-escape-text')).toHaveText(ESCAPE_RE);
  // 灰色も安全ではない、の注意は地図の下にいつも
  await expect(page.locator('#risk-panel')).toContainText('灰色も安全という意味ではありません。想定を超える揺れや津波もあり得ます');
  await expect(page.locator('#risk-panel .tsunami-attribution')).toContainText('ハザードマップポータルサイト');
  await expect(page.locator('#result-map .leaflet-control-attribution')).toContainText('ハザードマップポータルサイト');
  await noOverflow(page);
});

test('やることマップ: 津波の避難場所の大きな印と名前のラベル、逃げる方向の矢印と文。印はいちばん上', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI, '四日市市');
  const map = page.locator('#result-map');
  await expect(map.locator('.rm-shelter-tsunami').first()).toBeVisible();
  const label = map.locator('.rm-shelter-label');
  await expect(label).toHaveCount(1);
  expect((await label.innerText()).length).toBeGreaterThan(0);
  // 矢印（線と矢じり）と「逃げる方向」
  await expect(map.locator('path.rm-arrow')).toHaveCount(1);
  await expect(map.locator('path.rm-arrow-head')).toHaveCount(1);
  await expect(map.locator('.rm-escape-label')).toHaveText('近い津波の避難場所');
  await expect(page.locator('#risk-escape-text')).toHaveText(ESCAPE_RE);
  // 番号の「1」の津波の避難場所は、避難場所リストの先頭と同じ名前（ラベル）
  const no = Number(/「(\d)」/.exec(await page.locator('#risk-escape-text').innerText())![1]);
  const evacTsunami = page.locator('#evac ol.shelters').nth(1).locator('li strong');
  await expect(evacTsunami.nth(no - 1)).toHaveText(await label.innerText());
  // 避難場所のペインが、マス・津波タイル・自宅の印・矢印より上
  const z = await page.evaluate(() => {
    const pane = (c: string) => Number(getComputedStyle(document.querySelector(`#result-map .leaflet-${c}-pane`)!).zIndex);
    return { mesh: pane('mesh'), tsunami: pane('tsunami'), overlay: pane('overlay'), escape: pane('escape'), marker: pane('marker'), shelters: pane('shelters') };
  });
  expect(z.shelters).toBeGreaterThan(Math.max(z.mesh, z.tsunami, z.overlay, z.escape, z.marker));
  // 説明（ツールチップ）は印より上
  expect(await page.locator('#result-map .leaflet-tooltip-pane').evaluate((e) => Number(getComputedStyle(e).zIndex))).toBeGreaterThan(z.shelters);
  // 印の真ん中にあるのは印そのもの（どのズームでも同じ大きさ）
  const hit = async () => page.evaluate(() => {
    const out: string[] = [];
    const box = document.querySelector('#result-map')!.getBoundingClientRect();
    for (const m of document.querySelectorAll<HTMLElement>('#result-map .rm-shelter-tsunami')) {
      const r = m.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      // 地図の枠の中（見えている）印だけ
      if (r.width === 0 || cx < box.left || cx > box.right || cy < box.top || cy > box.bottom || cy < 0 || cy > innerHeight) continue;
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out.push(top && m.contains(top) ? 'ok' : `${top?.tagName}.${top?.getAttribute('class')}`);
    }
    return { out, size: [...document.querySelectorAll<HTMLElement>('#result-map .rm-shelter-tsunami')].map((m) => Math.round(m.getBoundingClientRect().width)) };
  });
  await map.scrollIntoViewIfNeeded();
  const before = await hit();
  expect(before.out.length).toBeGreaterThan(0);
  expect(before.out.filter((x) => x !== 'ok' && !x.includes('rm-shelter'))).toEqual([]);
  await map.getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(400);
  const after = await hit();
  expect(after.size.every((s) => s === before.size[0])).toBe(true);
  // 自宅の印も見えている（避難場所の印・矢印に隠れない）
  const home = await page.evaluate(() => {
    const marker = [...document.querySelectorAll('#result-map .leaflet-overlay-pane path')].find((p) => p.getAttribute('fill') === '#1F2A44')!;
    const r = marker.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === marker ? 'ok' : `${top?.tagName}.${top?.getAttribute('class')}`;
  });
  expect(home).toBe('ok');
  await noOverflow(page);
});

test('やることマップ: 自宅が浸水域外 → 矢印は出さず「念のため」の文。自宅はここ は「比較的低い」等', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, 'none');
  await search(page, KOMONO, '菰野町吉澤');
  await expect(page.locator('#result-map path.rm-arrow')).toHaveCount(0);
  await expect(page.locator('#risk-escape-text')).toContainText('念のため');
  await expect(page.locator('#risk-escape-text')).toContainText('想定を超える津波もあり得る');
  await expect(page.locator('#result-map .rm-shelter-tsunami, #result-map .rm-shelter-quake').first()).toBeVisible();
  await expect(page.locator('#risk-home .rm-home-title')).not.toHaveText('すぐ高い所へ');
  // 「判定できません」の行は、斜線のマスを実際に描いたときだけ
  for (const m of ['both', 'shake', 'tsunami']) {
    await page.locator(`#risk-mode-${m}`).click();
    const drawn = await page.locator('#result-map path.rm-unknown').count();
    expect((await legendTitles(page)).includes('判定できません')).toBe(drawn > 0);
  }
});

test('やることマップ（こども）: 浸水域外は やじるし なし。ことばの わくは あかではない（こん）', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, 'none');
  await search(page, KOMONO, '菰野町吉澤');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  await expect(page.locator('#kid-risk-map path.rm-arrow')).toHaveCount(0);
  const go = page.locator('#kid-risk-go');
  await expect(go).toHaveClass(/rm-kid-go-soft/);
  await expect(go).toHaveCSS('border-top-color', 'rgb(31, 42, 68)');
});

test('やることマップ: 津波が判定できない（タイル 500）→ 津波なし扱いにせず斜線と「判定できません」。矢印なし', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, 'error');
  await search(page, YOKKAICHI, '四日市市');
  await expect(page.locator('#result-map path.rm-unknown').first()).toBeAttached();
  await expect(page.locator('#result-map path.rm-wave')).toHaveCount(0);
  expect(await legendTitles(page)).toContain('判定できません');
  await expect(page.locator('#result-map path.rm-arrow')).toHaveCount(0);
  await expect(page.locator('#risk-escape-text')).toContainText('判定できない');
  await expect(page.locator('#risk-home .rm-home-title')).not.toHaveText('比較的低い');
});

test('やることマップ: 地図タイルも津波タイルも読めない（電波なし）ときも、マス・避難場所の印・凡例は出る', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await page.route('**/disaportaldata.gsi.go.jp/**', (r) => r.abort());
  await search(page, YOKKAICHI, '四日市市');
  expect(await page.locator('#result-map path.rm-cell').count()).toBeGreaterThan(10);
  await expect(page.locator('#result-map .rm-shelter-tsunami').first()).toBeVisible();
  await expect(page.locator('#risk-legend li').first()).toBeVisible();
  expect(await legendTitles(page)).toContain('津波の避難場所（高い所・建物の上の階）');
  await expect(page.locator('#risk-home .rm-home-title')).toBeVisible();
});

test('やることマップ: 対応範囲外 → 避難場所の印・矢印なし、自宅はここ は「対応範囲外」', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, { lat: 35.148, lon: 139.108 }, '神奈川県足柄下郡湯河原町', false);
  await expect(page.getByText('この地域はまだ対応していません')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#result-map .rm-shelter')).toHaveCount(0);
  await expect(page.locator('#result-map path.rm-arrow')).toHaveCount(0);
  await expect(page.locator('#risk-home .rm-home-title')).toHaveText('対応範囲外');
  await expect(page.locator('#risk-escape-text')).toHaveCount(0);
});

test('やることマップ（こども）: 両方の地図・おうち・にげる ばしょ・やじるし・ひらがなの凡例と ことば。390px で はみ出さない', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI, '四日市市');
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  const k = page.locator('#kid-risk');
  await expect(k).toBeVisible();
  await expect(k.getByRole('heading')).toHaveText(/^おうちの まわりの\s*きけん マップ$/);
  const map = page.locator('#kid-risk-map');
  await expect(map.locator('.rm-home-kids')).toHaveText('おうち');
  await expect(map.locator('.rm-label-kids')).toHaveText('にげる ばしょ');
  await expect(map.locator('.rm-shelter-tsunami').first()).toBeVisible();
  await expect(map.locator('.rm-shelter-quake')).toHaveCount(0);
  await expect(map.locator('path.rm-arrow')).toHaveCount(1);
  await expect(map.locator('.rm-escape-label')).toHaveText('にげる ばしょ');
  // 切りかえは無い（両方だけ）。地理院の津波タイルは重ねない
  await expect(k.locator('.rm-modes')).toHaveCount(0);
  await expect(map.locator('img[src*="04_tsunami_newlegend_data"]')).toHaveCount(0);
  await expect(k.locator('.rm-legend li')).toHaveText([
    'にげる ばしょ（たかい ところ・たかい たてもの）', 'いえが こわれやすく、つなみも くる ところ', 'つなみが くる ところ', 'いえが こわれやすい ところ',
    'はいいろ：わりと ひくい（でも ゆだんしない）',
  ]);
  await expect(k.locator('#kid-risk-go .rm-kid-go-small')).toHaveText('ゆれが とまったら すぐ');
  await expect(k.locator('#kid-risk-go .rm-kid-go-big')).toHaveText('みどりの やじるしの ほうへ にげる');
  await expect(k.locator('#kid-risk-go')).toHaveCSS('border-top-color', 'rgb(217, 56, 30)');
  await expect(k.locator('.rm-kid-foot')).toContainText('はいいろの ところも、ゆだんは しないでね。');
  // ちず の そと（凡例・ことば）は ひらがな・カタカナだけ（出典は地図の中）
  const text = await k.evaluate((e) => [...e.querySelectorAll('h2, .rm-legend, #kid-risk-go, .rm-kid-foot')].map((n) => (n as HTMLElement).innerText).join(''));
  expect(text).not.toMatch(/[一-鿿]/);
  await expect(map).toHaveAttribute('aria-label', /^おうちの まわりの きけん マップ。みどりの やじるしの ほうへ にげる。/);
  // あかは「にげる」の枠だけ（マスの色に赤系なし）
  const fills = await map.locator('path.rm-cell').evaluateAll((ps) => [...new Set(ps.map((p) => p.getAttribute('fill')))]);
  for (const f of fills) expect(['#8E7CC3', '#8FBCE8', '#E8A33D', '#E3E1DA', '#D6D6D6']).toContain(f);
  await noOverflow(page);
  // タブを変えても地図は出る
  await page.getByRole('tab', { name: 'ひがしがわ だけ' }).click();
  await expect(page.locator('#kid-risk-map path.rm-cell').first()).toBeAttached({ timeout: 30_000 });
});

test('やることマップ: 390×844 の撮影（おとな 両方・揺れ・津波／こども）', async ({ page }) => {
  test.skip(!hasRealData, 'public/data に実データが無いためスキップ');
  await stubTsunami(page, COAST);
  await search(page, YOKKAICHI, '四日市市');
  const panel = page.locator('#risk-panel');
  for (const m of ['both', 'shake', 'tsunami'] as const) {
    await page.locator(`#risk-mode-${m}`).click();
    await panel.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `reports/riskmap-${m}-390x844.png` });
  }
  await page.locator('#risk-mode-both').click();
  await page.getByRole('button', { name: 'こども', exact: true }).click();
  const k = page.locator('#kid-risk');
  await k.evaluate((e) => e.scrollIntoView({ block: 'start' }));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'reports/riskmap-kids-390x844.png' });
});
