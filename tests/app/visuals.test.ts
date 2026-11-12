import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TSUNAMI_BANDS } from '../../src/core/tsunami.ts';
import { homeTsunamiVM, type OkHomeVM, type TsunamiVM } from '../../src/app/viewmodel.ts';
import {
  depthPhrase, intensityLevel, maxIntensity, parsePct, rangeAriaLabel, rangeNumbers, splitIntensity, summaryTiles,
  tenHouses, tsunamiMid, tsunamiPictureVM,
} from '../../src/app/visuals.ts';

const band = (label: string) => TSUNAMI_BANDS.find((b) => b.label === label)!;

test('intensityLevel: 震度4以下・5弱〜7', () => {
  assert.equal(intensityLevel('震度3以下'), 'le4');
  assert.equal(intensityLevel('震度4'), 'le4');
  assert.equal(intensityLevel('震度5弱'), '5-');
  assert.equal(intensityLevel('震度5強'), '5+');
  assert.equal(intensityLevel('震度6弱'), '6-');
  assert.equal(intensityLevel('震度6強'), '6+');
  assert.equal(intensityLevel('震度7'), '7');
});

test('splitIntensity: 震度だけ切り出し、つなげると元に戻る', () => {
  const t = '先に東側で震度6弱、後に西側で震度6強';
  const s = splitIntensity(t);
  assert.deepEqual(s, [
    { text: '先に東側で', intensity: false }, { text: '震度6弱', intensity: true },
    { text: '、後に西側で', intensity: false }, { text: '震度6強', intensity: true },
  ]);
  assert.equal(s.map((x) => x.text).join(''), t);
  assert.deepEqual(splitIntensity('震度3以下'), [{ text: '震度3以下', intensity: true }]);
});

test('maxIntensity: 強いほう（時間差）', () => {
  assert.equal(maxIntensity('先に東側で震度6強、後に西側で震度5強'), '震度6強');
  assert.equal(maxIntensity('先発 震度5弱・後発 震度7'), '震度7');
  assert.equal(maxIntensity('震度4'), '震度4');
  assert.equal(maxIntensity('なし'), null);
});

test('parsePct / rangeNumbers: 表示の文字列から割合', () => {
  assert.ok(Math.abs(parsePct('12.3%')! - 0.123) < 1e-12);
  assert.equal(parsePct('0.1%未満'), 0.0005);
  assert.equal(parsePct('100.0%'), 1);
  assert.equal(parsePct('abc'), null);
  const r = rangeNumbers({ min: '5.0%', max: '20.0%', central: '10.0%' })!;
  assert.ok(Math.abs(r.min - 0.05) < 1e-12 && Math.abs(r.max - 0.2) < 1e-12 && Math.abs(r.central - 0.1) < 1e-12);
  assert.equal(rangeNumbers({ min: '?', max: '20.0%', central: '10.0%' }), null);
});

test('tenHouses: 代表値×10 を丸め、合計10軒まで。0より大きく0軒に丸まれば「1軒未満」', () => {
  assert.deepEqual(tenHouses(0.23, 0.31), { full: 2, half: 3, caption: '10軒あったら：全壊 約2軒・半壊 約3軒' });
  assert.deepEqual(tenHouses(0.03, 0.12), { full: 0, half: 1, caption: '10軒あったら：全壊 1軒未満・半壊 約1軒' });
  assert.deepEqual(tenHouses(0, 0), { full: 0, half: 0, caption: '10軒あったら：全壊 約0軒・半壊 約0軒' });
  // 合計が10を超えるときは半壊を切る
  const t = tenHouses(0.66, 0.45);
  assert.equal(t.full, 7);
  assert.equal(t.half, 3);
  assert.ok(t.full + t.half <= 10);
  // 0.5軒ちょうどは切り上げ（浮動小数で切り下げない）
  assert.equal(tenHouses(parsePct('25.0%')!, parsePct('35.0%')!).full, 3);
  assert.equal(tenHouses(parsePct('25.0%')!, parsePct('35.0%')!).half, 4);
  assert.deepEqual(tenHouses(1, 0.2), { full: 10, half: 0, caption: '10軒あったら：全壊 約10軒・半壊 約0軒' });
  // 「0.1%未満」は 0 より大きい
  assert.equal(tenHouses(parsePct('0.1%未満')!, 0).caption, '10軒あったら：全壊 1軒未満・半壊 約0軒');
});

test('rangeAriaLabel', () => {
  assert.equal(rangeAriaLabel('全壊', { min: '5.0%', max: '20.1%', central: '12.3%' }), '全壊 代表値12.3% 幅5.0%〜20.1%');
});

test('depthPhrase: 段階の代表値ごと', () => {
  const got = TSUNAMI_BANDS.map((b) => depthPhrase(b.mid));
  assert.deepEqual(got, ['足首くらい', 'ひざくらい', '腰くらい', '1階の天井近くまで', '2階の床より上', '2階の屋根近くまで', '家が完全に沈む高さ', '家が完全に沈む高さ']);
});

test('homeTsunamiVM: 段階の代表値（mid）と到達（分）を持つ。既存の項目はそのまま', () => {
  const a = homeTsunamiVM(band('1〜3m'), { min: 12, cm: 30 });
  assert.deepEqual(a, { kind: 'band', depth: '1〜3m', arrival: '海岸への到達 最短約12分（30cm）', urgent: false, mid: 2, arrivalMin: 12 });
  const n = homeTsunamiVM({ nearby: band('3〜5m') }, null);
  assert.ok(n.kind === 'nearby' && n.mid === 4 && n.arrivalMin === null && n.urgent);
  assert.deepEqual(homeTsunamiVM('none', { min: 12, cm: 30 }), { kind: 'none' });
  assert.deepEqual(homeTsunamiVM('unknown', null), { kind: 'unknown' });
});

test('tsunamiMid: mid があればそれ、無ければ（前回の結果）段階の表記から', () => {
  assert.equal(tsunamiMid({ kind: 'band', depth: '1〜3m', arrival: null, urgent: true, mid: 2 }), 2);
  assert.equal(tsunamiMid({ kind: 'band', depth: '5〜10m', arrival: null, urgent: true }), 7.5);
  assert.equal(tsunamiMid({ kind: 'band', depth: '?', arrival: null, urgent: true }), null);
  assert.equal(tsunamiMid({ kind: 'none' }), null);
});

test('tsunamiPictureVM: band / nearby だけ。10m以上は絵の上限まで水にして「家より高い」', () => {
  assert.equal(tsunamiPictureVM({ kind: 'none' }), null);
  assert.equal(tsunamiPictureVM({ kind: 'unknown' }), null);
  const b = tsunamiPictureVM(homeTsunamiVM(band('0.5〜1m'), null))!;
  assert.equal(b.waterM, 0.75);
  assert.equal(b.loM, 0.5);
  assert.equal(b.hiM, 1);
  assert.equal(b.nearby, false);
  assert.equal(b.overHouse, false);
  assert.equal(b.phrase, '腰くらい');
  assert.match(b.aria, /浸水深 0\.5〜1m（想定）。腰くらい/);
  const n = tsunamiPictureVM(homeTsunamiVM({ nearby: band('1〜3m') }, null))!;
  assert.equal(n.phrase, '近くで1階の天井近くまで');
  assert.match(n.aria, /すぐ近く/);
  assert.match(n.aria, /自宅の地点は浸水域外/);
  assert.equal(n.nearby, true);
  // 5〜10m は幅の上端を絵の上限（8m）で切る
  const five = tsunamiPictureVM(homeTsunamiVM(band('5〜10m'), null))!;
  assert.deepEqual([five.loM, five.waterM, five.hiM], [5, 7.5, 8]);
  // 前回の結果（mid なし）でも段階の表記から幅
  const saved = tsunamiPictureVM({ kind: 'band', depth: '3〜5m', arrival: null, urgent: true })!;
  assert.deepEqual([saved.loM, saved.waterM, saved.hiM], [3, 4, 5]);
  const deep = tsunamiPictureVM(homeTsunamiVM(band('10〜20m'), null))!;
  assert.equal(deep.overHouse, true);
  assert.equal(deep.waterM, 8);
  assert.deepEqual([deep.loM, deep.hiM], [8, 8]);
  assert.equal(tsunamiPictureVM(homeTsunamiVM(band('20m以上'), null))!.waterM, 8);
  assert.equal(deep.phrase, '家が完全に沈む高さ');
  assert.match(deep.aria, /家より高い/);
});

const okHome = (over: Partial<OkHomeVM> = {}): OkHomeVM => ({
  status: 'ok', intensityLabel: '震度6弱',
  collapse: { min: '5.0%', max: '20.0%', central: '12.3%' }, half: { min: '10.0%', max: '30.0%', central: '20.0%' },
  liquefaction: null, tsunami: { kind: 'none' }, notes: [], ...over,
});
const values = (tiles: ReturnType<typeof summaryTiles>) => tiles.map((t) => [t.key, t.value]);

test('summaryTiles: 揺れ・全壊・津波・到達', () => {
  const t: TsunamiVM = homeTsunamiVM(band('1〜3m'), { min: 15, cm: 30 });
  const tiles = summaryTiles(okHome(), t);
  assert.deepEqual(values(tiles), [['shake', '震度6弱'], ['collapse', '約12.3%'], ['tsunami', '浸水深 1〜3m'], ['arrival', '最短約15分（目安）']]);
  // 津波の札には行動の一言
  assert.equal((tiles[2] as { note?: string }).note, '揺れたらすぐ高い所へ');
  // 5分以内は「すぐ」、到達時間が不明は「すぐ（到達時間は不明）」
  assert.equal(summaryTiles(okHome(), homeTsunamiVM(band('1〜3m'), { min: 3, cm: 30 }))[3].value, 'すぐ');
  assert.equal(summaryTiles(okHome(), homeTsunamiVM(band('1〜3m'), null))[3].value, 'すぐ（到達時間は不明）');
  assert.equal(summaryTiles(okHome(), homeTsunamiVM(band('1〜3m'), { min: null, cm: 30 }))[3].value, 'すぐ（到達時間は不明）');
  // 近く
  const near = summaryTiles(okHome(), homeTsunamiVM({ nearby: band('3〜5m') }, { min: 20, cm: 30 }))[2] as { value: string; note?: string };
  assert.equal(near.value, '近くで 最大3〜5m');
  assert.equal(near.note, '揺れたらすぐ高い所へ');
  // 浸水域外・判定できない: 到達の札なし
  assert.deepEqual(values(summaryTiles(okHome(), { kind: 'none' })), [['shake', '震度6弱'], ['collapse', '約12.3%'], ['tsunami', '想定の浸水域外']]);
  assert.equal((summaryTiles(okHome(), { kind: 'none' })[2] as { note?: string }).note, undefined);
  assert.equal(summaryTiles(okHome(), { kind: 'unknown' })[2].value, '判定できません');
  // 0.1%未満は「約」を付けない
  assert.equal(summaryTiles(okHome({ collapse: { min: '0.1%未満', max: '0.1%未満', central: '0.1%未満' } }), { kind: 'none' })[1].value, '0.1%未満');
});

test('summaryTiles: 時間差は強いほうの震度と合計。データなし・読み込み中', () => {
  const lag = okHome({ intensityLabel: '先に東側で震度5強、後に西側で震度6強', stages: [] });
  const tiles = summaryTiles(lag, { kind: 'none' });
  assert.equal(tiles[0].value, '震度6強');
  assert.equal(tiles[0].label, '揺れ（強いほう）');
  assert.equal(tiles[1].label, '自宅の全壊（合計）');
  assert.deepEqual(values(summaryTiles({ status: 'nodata' }, { kind: 'none' })).slice(0, 2), [['shake', 'データなし'], ['collapse', 'データなし']]);
  assert.deepEqual(values(summaryTiles({ status: 'error' }, { kind: 'none' })).slice(0, 2), [['shake', '読み込めませんでした'], ['collapse', '読み込めませんでした']]);
  assert.deepEqual(values(summaryTiles('loading', { kind: 'none' })).slice(0, 2), [['shake', '読み込み中'], ['collapse', '読み込み中']]);
});
