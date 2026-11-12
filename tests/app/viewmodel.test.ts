import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../fixtures/fragility.synthetic.json' with { type: 'json' };
import { useFragilityTable, type FragilityTable } from '../../src/core/fragility.ts';
import { estimateArea } from '../../src/core/neighborhood.ts';
import type { BuildingStock, HazardCell, HomeInput, Shelter } from '../../src/core/types.ts';
import { TSUNAMI_BANDS } from '../../src/core/tsunami.ts';
import { areaLagViewModel, homeLagViewModel, areaViewModel, evacuationViewModel, formatPct, homeViewModel, intensityLabel, locationNote } from '../../src/app/viewmodel.ts';

before(() => useFragilityTable(fixture as unknown as FragilityTable));

const cell = (o: Partial<HazardCell> = {}): HazardCell => ({
  intensity: 6.2, pl: null, settlementCm: null, tsunamiDepth: null, tsunamiArrivalMin: null, ...o,
});
const home = (o: Partial<HomeInput> = {}): HomeInput => ({ structure: 'wood', era: 'pre1981', retrofitted: false, ...o });
const pct = (s: string) => parseFloat(s.replace('%未満', '').replace('%', ''));

const UNKNOWN_NOTE = 'わからない項目があるため幅が広くなっています';
const FLOORS_NOTE = '階数を入れると幅が狭くなります';
const RETRO_NOTE = '耐震補強をした場合として、ひとつ新しい年代の基準で計算しています';
const NOTICES = [
  'データは最新でない場合や未掲載の場合があります。最新の指定状況は市町にご確認ください',
  '指定緊急避難場所（命を守るために緊急に逃げる場所）と指定避難所（一定期間滞在する施設）は別のものです',
  '指定緊急避難場所は災害の種類ごとに指定されています。地震・津波に対応しているかを確認してください',
];

test('intensityLabel の境界', () => {
  assert.equal(intensityLabel(6.5), '震度7');
  assert.equal(intensityLabel(6.49), '震度6強');
  assert.equal(intensityLabel(6.0), '震度6強');
  assert.equal(intensityLabel(5.99), '震度6弱');
  assert.equal(intensityLabel(5.5), '震度6弱');
  assert.equal(intensityLabel(5.0), '震度5強');
  assert.equal(intensityLabel(4.5), '震度5弱');
  assert.equal(intensityLabel(4.49), '震度4');
  assert.equal(intensityLabel(3.5), '震度4');
  assert.equal(intensityLabel(3.49), '震度3以下');
});

test('formatPct', () => {
  assert.equal(formatPct(0.1234), '12.3%');
  assert.equal(formatPct(0.0004), '0.1%未満');
  assert.equal(formatPct(0), '0.1%未満');
  assert.equal(formatPct(0.001), '0.1%');
  assert.equal(formatPct(1), '100.0%');
});

test("'outside' / null の伝搬", () => {
  assert.deepEqual(homeViewModel('outside', home(), 'none', null), { status: 'outside' });
  assert.deepEqual(homeViewModel(null, home(), 'none', null), { status: 'nodata' });
  assert.deepEqual(homeViewModel(cell({ intensity: null }), home(), 'none', null), { status: 'nodata' });
  assert.deepEqual(homeViewModel(cell({ intensity: NaN }), home(), 'none', null), { status: 'nodata' });
});

test('homeViewModel: 通常ケース', () => {
  const vm = homeViewModel(cell(), home(), 'none', null);
  assert.equal(vm.status, 'ok');
  if (vm.status !== 'ok') return;
  assert.equal(vm.intensityLabel, '震度6強');
  assert.equal(vm.liquefaction, null);
  assert.deepEqual(vm.notes, []);
  assert.ok(pct(vm.collapse.min) <= pct(vm.collapse.central) && pct(vm.collapse.central) <= pct(vm.collapse.max));
});

test('液状化: 沈下量があれば整数cmで文言、null なら null', () => {
  const vm = homeViewModel(cell({ settlementCm: 12.6 }), home(), 'none', null);
  assert.equal(vm.status === 'ok' && vm.liquefaction, '液状化で地盤が約13cm沈下するおそれ');
});

test('わからない: 注記が付き 最小 ≤ 代表 ≤ 最大、幅が広がる', () => {
  const known = homeViewModel(cell(), home(), 'none', null);
  const vm = homeViewModel(cell(), home({ structure: 'unknown', era: 'unknown' }), 'none', null);
  assert.equal(vm.status, 'ok');
  if (vm.status !== 'ok' || known.status !== 'ok') return;
  assert.ok(vm.notes.includes(UNKNOWN_NOTE));
  assert.ok(!known.notes.includes(UNKNOWN_NOTE));
  for (const k of ['collapse', 'half'] as const) {
    assert.ok(pct(vm[k].min) <= pct(vm[k].central) && pct(vm[k].central) <= pct(vm[k].max), k);
  }
  assert.ok(pct(vm.collapse.max) - pct(vm.collapse.min) > pct(known.collapse.max) - pct(known.collapse.min));
  // 片方だけ unknown でも付く
  const one = homeViewModel(cell(), home({ era: 'unknown' }), 'none', null);
  assert.ok(one.status === 'ok' && one.notes.includes(UNKNOWN_NOTE));
});

test('鉄骨・RC で階数なし → 注記、階数あり → なし、木造は出さない', () => {
  for (const structure of ['steel', 'rc'] as const) {
    const a = homeViewModel(cell(), home({ structure, era: 'post2000' }), 'none', null);
    assert.ok(a.status === 'ok' && a.notes.includes(FLOORS_NOTE), structure);
    const b = homeViewModel(cell(), home({ structure, era: 'post2000', floors: 5 }), 'none', null);
    assert.ok(b.status === 'ok' && !b.notes.includes(FLOORS_NOTE), structure);
  }
  const w = homeViewModel(cell(), home(), 'none', null);
  assert.ok(w.status === 'ok' && !w.notes.includes(FLOORS_NOTE));
});

test('補強済みの注記と注記の順序', () => {
  const vm = homeViewModel(cell(), home({ structure: 'unknown', era: 'unknown', retrofitted: true }), 'none', null);
  assert.ok(vm.status === 'ok');
  const vm2 = homeViewModel(cell(), home({ structure: 'steel', retrofitted: true }), 'none', null);
  assert.deepEqual(vm2.status === 'ok' && vm2.notes, [FLOORS_NOTE, RETRO_NOTE]);
  const vm3 = homeViewModel(cell(), home({ structure: 'unknown', retrofitted: true }), 'none', null);
  assert.deepEqual(vm3.status === 'ok' && vm3.notes, [UNKNOWN_NOTE, RETRO_NOTE]);
});

const wood100: BuildingStock = { total: 100, shares: { 'wood:pre1981': 1 } };

test('areaViewModel: ストックの無いメッシュだけ → nostock', () => {
  assert.deepEqual(areaViewModel({ a: cell() }, {}, ['a']), { status: 'nostock' });
  assert.deepEqual(areaViewModel({}, { a: wood100 }, ['a']), { status: 'nostock' });
});

test('areaViewModel: 建物データが不正なら unavailable（例外を外に出さない）', () => {
  const broken = { total: 100, shares: { 'wood:pre1981': 0.3 } } as BuildingStock; // 合計が1でない
  assert.deepEqual(areaViewModel({ a: cell() }, { a: broken }, ['a']), { status: 'unavailable' });
});

test('locationNote: どの場所で計算したかの一文', () => {
  assert.equal(locationNote({ kind: 'address', label: '三重県津市広明町' }), '三重県津市広明町 付近で計算しました');
  assert.equal(locationNote({ kind: 'pin' }), '地図で選んだ場所で計算しました');
  assert.equal(locationNote({ kind: 'gps' }), '現在地で計算しました');
});

test('areaViewModel: estimateArea と一致（10棟単位に丸め）', () => {
  const cells = { a: cell(), b: cell({ intensity: 5.5 }) };
  const stock = { a: wood100, b: { total: 237, shares: { 'wood:post2000': 0.5, 'rc:pre1981': 0.5 } } as BuildingStock };
  const raw = estimateArea(cells, stock, ['a', 'b', 'c']);
  const vm = areaViewModel(cells, stock, ['a', 'b', 'c']);
  assert.deepEqual(vm, {
    status: 'ok',
    collapse: Math.round(raw.collapse / 10) * 10,
    half: Math.round(raw.half / 10) * 10,
    meshes: raw.countedMeshes,
  });
  assert.equal(vm.status === 'ok' && vm.collapse % 10, 0);
});

const sh = (id: string, dLat: number, o: Partial<Shelter> = {}): Shelter => ({
  id, name: id, pos: { lat: 35 + dLat, lon: 135 }, earthquake: true, tsunami: false, ...o,
});
const origin = { lat: 35, lon: 135 };

test('evacuation: 地震用は earthquake:true だけ・最大5件・注意文3つ', () => {
  const shelters = [
    ...Array.from({ length: 7 }, (_, i) => sh(`e${i}`, 0.001 * (i + 1))),
    sh('t-only', 0.0001, { earthquake: false, tsunami: true }),
  ];
  const lists = evacuationViewModel(origin, shelters, null);
  assert.equal(lists.length, 2);
  assert.equal(lists[0].hazard, 'earthquake');
  assert.equal(lists[0].items.length, 5);
  assert.ok(!lists[0].items.some((i) => i.name === 't-only'));
  assert.equal(lists[0].items[0].name, 'e0');
  assert.deepEqual(lists[0].notices, NOTICES);
  for (const i of lists[0].items) assert.equal(i.reach, 'n/a');
});

test('evacuation: 津波深さがあれば津波リストも（ゆっくり徒歩で到達判定）', () => {
  const shelters = [
    sh('near', 0.001, { tsunami: true }), // 約111m
    sh('far', 0.02, { tsunami: true }),   // 約2.2km
  ];
  const lists = evacuationViewModel(origin, shelters, { min: 30, cm: 30 });
  assert.deepEqual(lists.map((l) => l.hazard), ['earthquake', 'tsunami']);
  const t = lists[1];
  assert.deepEqual(t.items.map((i) => i.name), ['near', 'far']);
  assert.equal(t.items[0].reach, 'ok');   // ゆっくり: 111*1.3/0.5/60 ≈ 4.8分 < 24
  assert.equal(t.items[1].reach, 'no');   // ≈ 96分 > 30
  assert.deepEqual(t.notices, NOTICES);
});

test('evacuation: 到達時間が無い・5分以内は判定せず「揺れが収まったらすぐ高い所へ」（津波リストのみ。地震は空）', () => {
  const s = [sh('x', 0.001, { tsunami: true }), sh('e', 0.0005)];
  for (const arrival of [null, { min: null, cm: 30 }, { min: 5, cm: 30 }, { min: 3, cm: 50 }]) {
    const l = evacuationViewModel(origin, s, arrival);
    assert.deepEqual(l.map((x) => x.hazard), ['earthquake', 'tsunami'], JSON.stringify(arrival));
    assert.deepEqual(l[1].items.map((i) => i.name), ['x']);
    assert.equal(l[1].items[0].reach, 'n/a');
    assert.equal(l[1].items[0].reachText, '揺れが収まったらすぐ高い所へ');
    assert.ok(l[0].items.every((i) => i.reachText === ''));
  }
});

test('evacuation: 判定の文言（ok / tight / no）', () => {
  const s = [sh('near', 0.001, { tsunami: true }), sh('far', 0.02, { tsunami: true })]; // ゆっくり ≈4.8分 / ≈96分
  const t = evacuationViewModel(origin, s, { min: 30, cm: 30 })[1].items;
  assert.equal(t[0].reachText, 'すぐ避難を始めれば間に合う可能性');
  assert.equal(t[1].reachText, '間に合わないおそれ。近くの高い建物や高台へ');
  assert.equal(evacuationViewModel(origin, [s[0]], { min: 12, cm: 30 })[1].items[0].reachText, 'ぎりぎり。より近い高い場所も考えて');
});

test('evacuation: 距離・徒歩の書式', () => {
  const l = evacuationViewModel(origin, [sh('a', 0.001), sh('b', 0.02)], null);
  const [a, b] = l[0].items;
  assert.match(a.distance, /^約\d+0m$/);
  assert.equal(a.distance, '約110m');
  assert.match(b.distance, /^約\d+\.\dkm$/);
  assert.equal(b.distance, '約2.2km');
  assert.match(a.walkStandard, /^約\d+分$/);
  assert.equal(a.walkStandard, '約3分'); // 111*1.3/60 = 2.4 → 3
  assert.equal(a.walkSlow, '約5分');     // 4.8 → 5
});

test('液状化: 非有限・0cm に丸まる値は null', () => {
  for (const v of [NaN, Infinity]) {
    // 非有限はデータ不正として estimateHome が null → 'nodata'（「約NaNcm」は出ない）
    assert.deepEqual(homeViewModel(cell({ settlementCm: v }), home(), 'none', null), { status: 'nodata' }, String(v));
  }
  for (const v of [0, 0.4]) {
    const vm = homeViewModel(cell({ settlementCm: v }), home(), 'none', null);
    assert.ok(vm.status === 'ok' && vm.liquefaction === null, String(v));
  }
  const vm = homeViewModel(cell({ settlementCm: 0.5 }), home(), 'none', null);
  assert.ok(vm.status === 'ok' && vm.liquefaction === '液状化で地盤が約1cm沈下するおそれ');
});



test('距離の境界: 994m → 約990m, 996m → 約1.0km', async () => {
  const { distanceM } = await import('../../src/core/mesh.ts');
  const perDeg = distanceM(origin, { lat: 36, lon: 135 });
  const at = (m: number) => sh('d', m / perDeg);
  assert.equal(evacuationViewModel(origin, [at(994)], null)[0].items[0].distance, '約990m');
  assert.equal(evacuationViewModel(origin, [at(996)], null)[0].items[0].distance, '約1.0km');
  assert.equal(evacuationViewModel(origin, [at(999)], null)[0].items[0].distance, '約1.0km');
});

test("reach は 'tight' になりうる（ゆっくり徒歩 ≈4.8分 / 到達12分、+5分で9.8分）", () => {
  const l = evacuationViewModel(origin, [sh('n', 0.001, { tsunami: true })], { min: 12, cm: 30 });
  assert.equal(l[1].items[0].reach, 'tight');
});

const band = (label: string) => TSUNAMI_BANDS.find((b) => b.label === label)!;

test('homeViewModel 津波: 段階あり・到達あり／なし', () => {
  const a = homeViewModel(cell(), home(), band('1〜3m'), { min: 12, cm: 30 });
  assert.ok(a.status === 'ok');
  assert.deepEqual(a.tsunami, { kind: 'band', depth: '1〜3m', arrival: '海岸への到達 最短約12分（30cm）', urgent: false });
  const b = homeViewModel(cell(), home(), band('20m以上'), null);
  assert.ok(b.status === 'ok');
  assert.deepEqual(b.tsunami, { kind: 'band', depth: '20m以上', arrival: null, urgent: true });
  const c = homeViewModel(cell(), home(), band('0.3m未満'), null);
  assert.ok(c.status === 'ok' && c.tsunami.kind === 'band' && c.tsunami.depth === '0.3m未満');
});

test('homeViewModel 津波: 津波を加えると被害が増え、幅が広がる。none は津波なしと同じ、unknown も津波なし', () => {
  const none = homeViewModel(cell(), home(), 'none', { min: 12, cm: 30 });
  const unk = homeViewModel(cell(), home(), 'unknown', { min: 12, cm: 30 });
  const deep = homeViewModel(cell(), home(), band('5〜10m'), { min: 12, cm: 30 });
  assert.ok(none.status === 'ok' && unk.status === 'ok' && deep.status === 'ok');
  assert.deepEqual(none.tsunami, { kind: 'none' });
  assert.deepEqual(unk.tsunami, { kind: 'unknown' });
  assert.deepEqual(none.collapse, unk.collapse);
  assert.ok(pct(deep.collapse.central) > pct(none.collapse.central));
  assert.ok(pct(deep.collapse.max) >= pct(deep.collapse.central) && pct(deep.collapse.min) <= pct(deep.collapse.central));
});

test('homeViewModel 津波: 到達5分以内でも urgent（到達は表示）', () => {
  const a = homeViewModel(cell(), home(), band('1〜3m'), { min: 3, cm: 30 });
  assert.ok(a.status === 'ok' && a.tsunami.kind === 'band');
  assert.equal(a.tsunami.urgent, true);
  assert.equal(a.tsunami.arrival, '海岸への到達 最短約3分（30cm）');
  const b = homeViewModel(cell(), home(), band('1〜3m'), { min: 6, cm: 30 });
  assert.ok(b.status === 'ok' && b.tsunami.kind === 'band' && b.tsunami.urgent === false);
});

test('homeViewModel 津波: 高さは到達時間のデータから（静岡は50cm）。min が null なら到達なし・urgent', () => {
  const a = homeViewModel(cell(), home(), band('1〜3m'), { min: 24, cm: 50 });
  assert.ok(a.status === 'ok' && a.tsunami.kind === 'band');
  assert.equal(a.tsunami.arrival, '海岸への到達 最短約24分（50cm）');
  assert.equal(a.tsunami.urgent, false);
  const b = homeViewModel(cell(), home(), band('1〜3m'), { min: null, cm: 30 });
  assert.ok(b.status === 'ok' && b.tsunami.kind === 'band');
  assert.equal(b.tsunami.arrival, null);
  assert.equal(b.tsunami.urgent, true);
});

import { reachHintText } from '../../src/app/viewmodel.ts';

test('evacuation: 津波リストは到達時間の高さ（cm）を持つ。地震リストと到達時間なしは null', () => {
  const s = [sh('x', 0.001, { tsunami: true })];
  const l = evacuationViewModel(origin, s, { min: 24, cm: 50 });
  assert.equal(l[0].arrivalCm, null);
  assert.equal(l[1].arrivalCm, 50);
  assert.equal(evacuationViewModel(origin, s, null)[1].arrivalCm, null);
});

test('reachHintText: 高さはデータの cm。不明なら高さを書かない', () => {
  assert.match(reachHintText(50), /到達時間（50cm）と比べた目安/);
  assert.match(reachHintText(30), /（30cm）/);
  for (const cm of [null, undefined]) {
    const t = reachHintText(cm);
    assert.doesNotMatch(t, /cm/);
    assert.match(t, /海岸への津波の到達時間と比べた目安/);
  }
});

// --- Ruling F2・F3: 浸水域内は常に強い一文。中心が浸水域外でも約50m以内に浸水があれば「すぐ近く」 ---
import { homeTsunamiLines } from '../../src/app/viewmodel.ts';

const STRONG = '浸水が想定される場所です。強い揺れや長い揺れを感じたら、到達時間を待たずにすぐ高い所へ避難してください';
const OUTSIDE_TEXT = '想定の浸水域の外です。ただし想定を超える津波もあり得ます。海の近くで強い揺れを感じたら高い所へ';
const ARRIVAL_NOTE = '到達時間は海岸に津波が着く最短の時間です。自宅にはそれより後に着きますが、早めの避難の目安にしてください';
const texts = (vm: ReturnType<typeof homeViewModel>) => (assert.ok(vm.status === 'ok'), homeTsunamiLines(vm.tsunami).map((l) => l.text));

test('homeTsunamiLines（F2）: 段階あり・到達時間あり（91分）でも、先頭に強い一文。到達の行と注記はそのまま', () => {
  assert.deepEqual(texts(homeViewModel(cell(), home(), band('1〜3m'), { min: 91, cm: 30 })), [
    STRONG, '津波 浸水深 1〜3m（想定）・海岸への到達 最短約91分（30cm）', ARRIVAL_NOTE,
  ]);
  const lines = homeTsunamiLines({ kind: 'band', depth: '1〜3m', arrival: null, urgent: false });
  assert.equal(lines[0].text, STRONG);
  assert.match(lines[0].cls, /strong/);
});

test('homeTsunamiLines（F2）: 到達5分以内・不明は強い一文に加えて「揺れが収まったらすぐ高い所へ」も残す', () => {
  assert.deepEqual(texts(homeViewModel(cell(), home(), band('1〜3m'), { min: 3, cm: 30 })), [
    STRONG, '津波 浸水深 1〜3m（想定）・海岸への到達 最短約3分（30cm）', ARRIVAL_NOTE, '揺れが収まったらすぐ高い所へ',
  ]);
  assert.deepEqual(texts(homeViewModel(cell(), home(), band('0.3m未満'), null)), [STRONG, '津波 浸水深 0.3m未満（想定）', '揺れが収まったらすぐ高い所へ']);
});

test('homeTsunamiLines: 浸水域外は Global Constraints の文言だけ、判定できないときは行なし（上の注意で伝える）', () => {
  assert.deepEqual(texts(homeViewModel(cell(), home(), 'none', { min: 12, cm: 30 })), [OUTSIDE_TEXT]);
  assert.deepEqual(texts(homeViewModel(cell(), home(), 'unknown', { min: 12, cm: 30 })), []);
});

test('homeViewModel（F3）: 中心は浸水域外だが近くに浸水 → nearby。被害はいちばん深い近くの段階で計算', () => {
  const near = homeViewModel(cell(), home(), { nearby: band('3〜5m') }, { min: 20, cm: 30 });
  const inside = homeViewModel(cell(), home(), band('3〜5m'), { min: 20, cm: 30 });
  assert.ok(near.status === 'ok' && inside.status === 'ok');
  assert.deepEqual(near.tsunami, { kind: 'nearby', depth: '3〜5m', arrival: '海岸への到達 最短約20分（30cm）', urgent: false });
  assert.deepEqual(near.collapse, inside.collapse);
  assert.deepEqual(near.half, inside.half);
  const none = homeViewModel(cell(), home(), 'none', { min: 20, cm: 30 });
  assert.ok(none.status === 'ok' && pct(near.collapse.central) > pct(none.collapse.central));
});

test('homeTsunamiLines（F3）: nearby は強い一文＋「すぐ近く（約50m以内）…（最大 段階）」。浸水域外の文言は出さない', () => {
  assert.deepEqual(texts(homeViewModel(cell(), home(), { nearby: band('1〜3m') }, { min: 20, cm: 30 })), [
    STRONG, 'すぐ近く（約50m以内）まで浸水が想定されています（最大 1〜3m）', '海岸への到達 最短約20分（30cm）', ARRIVAL_NOTE,
  ]);
  assert.deepEqual(texts(homeViewModel(cell(), home(), { nearby: band('0.5〜1m') }, null)), [
    STRONG, 'すぐ近く（約50m以内）まで浸水が想定されています（最大 0.5〜1m）', '揺れが収まったらすぐ高い所へ',
  ]);
});

// --- 和歌山県は +1m の到達時間（Ruling W-b）: 100cm 以上は m で表示 ---
import { arrivalHeightText } from '../../src/app/viewmodel.ts';

test('arrivalHeightText: 100cm 未満は「{cm}cm」、100cm 以上は「{cm/100}m」', () => {
  assert.equal(arrivalHeightText(30), '30cm');
  assert.equal(arrivalHeightText(50), '50cm');
  assert.equal(arrivalHeightText(99), '99cm');
  assert.equal(arrivalHeightText(100), '1m');
  assert.equal(arrivalHeightText(300), '3m');
  assert.equal(arrivalHeightText(150), '1.5m');
});

test('homeViewModel 津波・reachHintText: 和歌山（cm=100）は「（1m）」', () => {
  const a = homeViewModel(cell(), home(), band('1〜3m'), { min: 12, cm: 100 });
  assert.ok(a.status === 'ok' && a.tsunami.kind === 'band');
  assert.equal(a.tsunami.arrival, '海岸への到達 最短約12分（1m）');
  assert.equal(a.tsunami.urgent, false);
  const b = homeViewModel(cell(), home(), band('1〜3m'), { min: 1, cm: 100 });
  assert.ok(b.status === 'ok' && b.tsunami.kind === 'band');
  assert.equal(b.tsunami.arrival, '海岸への到達 最短約1分（1m）');
  assert.equal(b.tsunami.urgent, true);
  assert.match(reachHintText(100), /到達時間（1m）と比べた目安/);
  assert.doesNotMatch(reachHintText(100), /100cm/);
});

// --- Ruling W-d: 到達時間の高さが 30cm より高い（静岡 50cm・和歌山 1m）ときは、到達の行の下に注意を添える ---
import { arrivalCaveatText } from '../../src/app/viewmodel.ts';

const CAVEAT_50 = 'この時間は50cmの津波が着く時間です。それより低い津波はもっと早く着くことがあります';
const CAVEAT_1M = 'この時間は1mの津波が着く時間です。それより低い津波はもっと早く着くことがあります';

test('arrivalCaveatText: 30cm 以下は null、50cm・1m は高さの表記つきの注意', () => {
  assert.equal(arrivalCaveatText(30), null);
  assert.equal(arrivalCaveatText(50), CAVEAT_50);
  assert.equal(arrivalCaveatText(100), CAVEAT_1M);
});

test('homeTsunamiLines（W-d）: 和歌山（1m）・静岡（50cm）は到達の行のすぐ下に注意。三重（30cm）・到達時間なしは出さない', () => {
  assert.deepEqual(texts(homeViewModel(cell(), home(), band('1〜3m'), { min: 12, cm: 100 })), [
    STRONG, '津波 浸水深 1〜3m（想定）・海岸への到達 最短約12分（1m）', CAVEAT_1M, ARRIVAL_NOTE,
  ]);
  assert.deepEqual(texts(homeViewModel(cell(), home(), { nearby: band('1〜3m') }, { min: 24, cm: 50 })), [
    STRONG, 'すぐ近く（約50m以内）まで浸水が想定されています（最大 1〜3m）', '海岸への到達 最短約24分（50cm）', CAVEAT_50, ARRIVAL_NOTE,
  ]);
  assert.deepEqual(texts(homeViewModel(cell(), home(), band('1〜3m'), { min: 1, cm: 100 })), [
    STRONG, '津波 浸水深 1〜3m（想定）・海岸への到達 最短約1分（1m）', CAVEAT_1M, ARRIVAL_NOTE, '揺れが収まったらすぐ高い所へ',
  ]);
  for (const t of texts(homeViewModel(cell(), home(), band('1〜3m'), { min: 12, cm: 30 }))) assert.doesNotMatch(t, /それより低い津波/);
  for (const t of texts(homeViewModel(cell(), home(), band('1〜3m'), { min: null, cm: 100 }))) assert.doesNotMatch(t, /それより低い津波/);
  const lines = homeTsunamiLines({ kind: 'band', depth: '1〜3m', arrival: '海岸への到達 最短約12分（1m）', arrivalCaveat: CAVEAT_1M, urgent: false });
  assert.equal(lines.find((l) => l.text === CAVEAT_1M)?.cls, 'note tsunami-caveat');
});


// ---- 時間差 ----
const LABELS = ['先発（東側）', '後発まで含めた合計'] as const;
const unk = home({ structure: 'unknown', era: 'unknown' });

test('homeLagViewModel: stages は先発と合計の2段階。トップの collapse/half は合計。幅は先発以上', () => {
  const vm = homeLagViewModel(cell({ intensity: 5.6 }), cell({ intensity: 6.0 }), unk, 'none', null, LABELS);
  assert.equal(vm.status, 'ok');
  if (vm.status !== 'ok') return;
  assert.ok(vm.stages);
  assert.deepEqual(vm.stages!.map((s) => s.label), [...LABELS]);
  assert.deepEqual(vm.stages![1].collapse, vm.collapse);
  assert.deepEqual(vm.stages![1].half, vm.half);
  const [f, t] = vm.stages!;
  assert.ok(pct(t.collapse.min) >= pct(f.collapse.min));
  assert.ok(pct(t.collapse.max) >= pct(f.collapse.max));
  assert.ok(pct(t.collapse.central) >= pct(f.collapse.central));
  // 曲線3種・震度±0.5・わからない項目で幅が出る
  assert.ok(pct(f.collapse.max) > pct(f.collapse.min));
  assert.ok(pct(t.collapse.max) > pct(t.collapse.min));
  assert.ok(vm.notes.includes(UNKNOWN_NOTE));
});

test('homeLagViewModel: sides を渡すと震度の行は「先に東側で震度X、後に西側で震度Y」。渡さなければ従来の形', () => {
  const f = cell({ intensity: 5.6 }), s2 = cell({ intensity: 6.0 });
  const a = homeLagViewModel(f, s2, unk, 'none', null, LABELS, ['東側', '西側']);
  const b = homeLagViewModel(f, s2, unk, 'none', null, LABELS);
  assert.ok(a.status === 'ok' && b.status === 'ok');
  if (a.status !== 'ok' || b.status !== 'ok') return;
  assert.equal(a.intensityLabel, '先に東側で震度6弱、後に西側で震度6強');
  assert.equal(b.intensityLabel, '先発 震度6弱・後発 震度6強');
  assert.deepEqual({ ...a, intensityLabel: '' }, { ...b, intensityLabel: '' });
});

test('homeLagViewModel: 津波は合計だけに加わる（先発は変わらない）。津波の行は L2 と同じ形', () => {
  const band = TSUNAMI_BANDS[2];
  const a = homeLagViewModel(cell({ intensity: 5.6 }), cell({ intensity: 6.0 }), home(), 'none', null, LABELS);
  const b = homeLagViewModel(cell({ intensity: 5.6 }), cell({ intensity: 6.0 }), home(), band, { min: 20, cm: 30 }, LABELS);
  if (a.status !== 'ok' || b.status !== 'ok') return assert.fail('ok');
  assert.deepEqual(a.stages![0], b.stages![0]);
  assert.ok(pct(b.stages![1].collapse.central) >= pct(a.stages![1].collapse.central));
  assert.equal(b.tsunami.kind, 'band');
  assert.equal(a.tsunami.kind, 'none');
});

test('homeLagViewModel: 先発が データなし → nodata（後発だけで計算しない）。後発 null も nodata。outside は outside', () => {
  assert.deepEqual(homeLagViewModel(null, cell(), home(), 'none', null, LABELS), { status: 'nodata' });
  assert.deepEqual(homeLagViewModel(cell(), null, home(), 'none', null, LABELS), { status: 'nodata' });
  assert.deepEqual(homeLagViewModel(cell({ intensity: null }), cell(), home(), 'none', null, LABELS), { status: 'nodata' });
  assert.deepEqual(homeLagViewModel('outside', cell(), home(), 'none', null, LABELS), { status: 'outside' });
  assert.deepEqual(homeLagViewModel(cell(), 'outside', home(), 'none', null, LABELS), { status: 'outside' });
});

test('areaLagViewModel: 10棟単位に丸める。合計は先発だけ以上。先発か後発の無いメッシュだけなら nostock', () => {
  const stock = { a: { total: 1000, shares: { 'wood:pre1981': 1 } } };
  const f = { a: cell({ intensity: 5.5 }) }, s = { a: cell({ intensity: 6 }) };
  const lag = areaLagViewModel(f, s, stock, ['a']);
  const first = areaViewModel(f, stock, ['a']);
  assert.equal(lag.status, 'ok');
  if (lag.status !== 'ok' || first.status !== 'ok') return;
  assert.equal(lag.collapse % 10, 0);
  assert.ok(lag.collapse >= first.collapse);
  assert.deepEqual(areaLagViewModel(f, {}, stock, ['a']), { status: 'nostock' });
});
